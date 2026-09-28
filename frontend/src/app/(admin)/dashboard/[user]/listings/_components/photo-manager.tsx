"use client";

import { useState } from "react";
import { useApiInvalidate } from "@/hooks/use-api";
import {
  ArrowLeft,
  ArrowRight,
  ImageIcon,
  Loader2,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { authedFetch, errorMessage } from "@/lib/api";

// Gallery management for ONE listing — the frontend half of backend
// PR #16's ListingPhotoViewSet (registered at /listings/photos/<id>/).
// Contract, verified against main:
//   PATCH /listings/photos/<id>/   {order?: number, is_cover?: boolean}
//     - 400 {'error': 'Image cannot be changed through this endpoint...'}
//       if `image` is sent — so we never send it
//     - is_cover=true atomically clears every sibling first (backend
//       enforces at-most-one-cover inside transaction.atomic())
//   DELETE /listings/photos/<id>/
//     - deleting the cover auto-promotes the first remaining photo by
//       order (backend-side); deleting the last photo leaves the gallery
//       empty and the NEXT upload batch re-establishes a cover
//   Non-owners get 404 (owner-scoped get_queryset) — nothing to handle
//   client-side beyond the generic error path.
//
// Ordering model: LOCAL optimistic reorder with move left/right one slot
// at a time (swap with the neighbor). The backend stores `order` as a
// plain int with no swap endpoint, so "move by one" is the smallest
// correct unit: we PATCH the two affected photos with each other's
// positions. A full drag-and-drop reorder would mean renumbering the
// whole gallery — deliberately deferred until the UI graduates from
// skeleton-first (AGENTS.md: focus is functionality, not polish).
//
// Rendering context: mounted ONLY by the listing form's PhotosSection in edit mode
// (create mode has no photos yet — they attach to a listing id that
// doesn't exist until first save). Existing photos come from the form's
// own record query; NEWLY picked files (not yet uploaded) stay fully
// managed by the form as before and are NOT this component's concern.

export type ManagedPhoto = {
  id: number | string;
  image: string | null;
  is_cover: boolean;
  order: number;
};

export function PhotoManager({
  listingId,
  photos,
}: {
  listingId: string | number;
  photos: ManagedPhoto[];
}) {
  const invalidate = useApiInvalidate();

  // Pending-request bookkeeping — per-photo, not a global spinner, so
  // concurrent moves/deletes each show feedback on the exact photo
  // being acted on. Values are request tags ("move", "cover", "delete").
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  function setBusyFor(photoId: ManagedPhoto["id"], tag: string | null) {
    setBusy((prev) => ({ ...prev, [String(photoId)]: tag }));
  }

  async function patchPhoto(
    photoId: ManagedPhoto["id"],
    body: { order?: number; is_cover?: boolean },
  ) {
    const res = await authedFetch(`/listings/photos/${photoId}/`, {
      method: "PATCH",
      json: body,
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      throw new Error(
        (respBody as { error?: string }).error ??
          `Photo update failed (HTTP ${res.status})`,
      );
    }
  }

  async function run(photoId: ManagedPhoto["id"], tag: string, fn: () => Promise<void>) {
    setBusyFor(photoId, tag);
    setError(null);
    try {
      await fn();
      // After ANY successful gallery change, refresh the listings
      // caches: the gallery lives nested on the Listing resource
      // (listing.photos), and the preview page renders it from its
      // detail query. Raw PATCH/DELETE here is invisible to the
      // cache otherwise.
      invalidate("listings");
    } catch (err) {
      setError(errorMessage(err, "Photo update failed"));
    } finally {
      setBusyFor(photoId, null);
    }
  }

  // Swap `index` with its left/right neighbor by exchanging order values,
  // then PATCH both rows with each other's new position. Server state is
  // the source of truth — the invalidate() above refetches the gallery
  // with the applied ordering; no local mirror is kept (mirroring it
  // would risk drifting from server-side cover-promotion side effects).
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;

    const a = photos[index];
    const b = photos[target];

    return run(a.id, "move", async () => {
      await patchPhoto(a.id, { order: b.order });
      await patchPhoto(b.id, { order: a.order });
      // Two PATCHes, sequential, not Promise.all — with a plain int
      // order column there's a unique-ish expectation (not a DB
      // constraint, but the invariant the UI and upload code rely on);
      // sequential writes make the transient duplicate-order window
      // one request wide instead of racing both simultaneously.
    });
  }

  function setCover(photo: ManagedPhoto) {
    return run(photo.id, "cover", () => patchPhoto(photo.id, { is_cover: true }));
  }

  function removePhoto(photo: ManagedPhoto) {
    return run(photo.id, "delete", async () => {
      const res = await authedFetch(`/listings/photos/${photo.id}/`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const respBody = await res.json().catch(() => ({}));
        throw new Error(
          (respBody as { error?: string }).error ??
            `Delete failed (HTTP ${res.status})`,
        );
      }
      // Cover promotion on delete is backend-side — nothing to do here.
    });
  }

  if (photos.length === 0) return null;

  // Sorted once per render — server order is authoritative; `id` as the
  // deterministic tiebreak exactly matches the backend's own ordering
  // fallback (perform_destroy's promotion query orders by 'order', 'id').
  const sorted = [...photos].sort((a, b) => a.order - b.order || Number(a.id) - Number(b.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium leading-none">Gallery</p>
        <span className="text-muted-foreground text-xs">
          First photo is the cover unless you pick another
        </span>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {sorted.map((photo, index) => {
          const photoBusy = busy[String(photo.id)] ?? null;
          return (
            <div
              key={photo.id}
              className="bg-muted group relative aspect-square overflow-hidden rounded-md border"
            >
              {photo.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.image}
                  alt={`Photo ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center">
                  <ImageIcon className="size-5" />
                </div>
              )}

              {photo.is_cover && (
                <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Star className="size-2.5 fill-current" />
                  Cover
                </span>
              )}

              {/* Action row — always visible while that photo's request
                  is in flight, hover-revealed otherwise (same hover
                  pattern as the new-photo remove buttons below it). */}
              <div
                className={`absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 rounded bg-black/70 px-1 py-1 text-white transition ${
                  photoBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 text-white hover:bg-white/20 hover:text-white"
                  disabled={index === 0 || photoBusy !== null}
                  onClick={() => move(index, -1)}
                  aria-label="Move photo earlier"
                >
                  {photoBusy === "move" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowLeft className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 text-white hover:bg-white/20 hover:text-white"
                  disabled={photo.is_cover || photoBusy !== null}
                  onClick={() => setCover(photo)}
                  aria-label="Set as cover"
                >
                  {photoBusy === "cover" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Star className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive size-6 hover:bg-white/20"
                  disabled={photoBusy !== null}
                  onClick={() => removePhoto(photo)}
                  aria-label="Delete photo"
                >
                  {photoBusy === "delete" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 text-white hover:bg-white/20 hover:text-white"
                  disabled={index === sorted.length - 1 || photoBusy !== null}
                  onClick={() => move(index, 1)}
                  aria-label="Move photo later"
                >
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
