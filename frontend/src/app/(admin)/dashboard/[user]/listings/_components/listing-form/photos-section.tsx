"use client";

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";

import { ArrowDownTrayIcon } from "@/components/paddy-icons";
import { PaddyLabel } from "@/components/paddy-label";
import { cn } from "@/lib/utils";
import { PhotoManager, type ManagedPhoto } from "../photo-manager";

// Photos — the first thing on step 1 (Basics). Figma 288:8254: a
// "Photos" Label, the size/type note, then the File Upload Area
// (19:6652): #fafafa fill, 1px 4/4 dashed #d4d4d8, radius 8; the dashed
// line turns blue (#3b82f6) on hover, with a white + blue halo on focus.
//
// Photos are NOT react-hook-form fields. They upload to their own
// endpoint (POST /listings/<id>/photos/), which only exists once the
// listing has an id — so picked files are held in the stepper's state
// and uploaded after the final save, exactly like the old long form.
// In edit mode the photos already on the listing are managed live by
// PhotoManager (cover / reorder / delete hit the API straight away).

// Mirrors the backend's upload rules (backend/listings/views.py), so a
// bad file is refused at PICK time instead of after a failed upload:
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // MAX_PHOTO_BYTES
export const ALLOWED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"]; // ALLOWED_PHOTO_EXTENSIONS
export const MAX_PHOTOS_PER_LISTING = 20; // MAX_PHOTOS_PER_LISTING

// The "accept" hint for the OS file picker. Only a hint — people can
// still choose "All files", which is why every pick is re-checked below.
const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// A thumbnail of a picked (not yet uploaded) File. The blob URL is made
// in a ref callback and revoked by the callback's cleanup (React 19), so
// it lives exactly as long as the <img> — no leaked URLs, and no state
// or effect. (An earlier useMemo + effect version broke under Strict
// Mode: its dev-only unmount/remount revoked the URLs and never remade
// them.)
export function FileImage({
  file,
  alt,
  className,
}: {
  file: File;
  alt: string;
  className?: string;
}) {
  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const url = URL.createObjectURL(file);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={attach} alt={alt} className={className} />;
}

export function PhotosSection({
  files,
  onFilesChange,
  listingId,
  existingPhotos = [],
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  /** Edit mode: the listing whose saved photos PhotoManager manages. */
  listingId?: string | number;
  existingPhotos?: ManagedPhoto[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const existingCount = existingPhotos.length;
  const roomLeft = MAX_PHOTOS_PER_LISTING - existingCount - files.length;

  // Keeps every valid file and explains each refused one, instead of
  // throwing out a whole batch over one bad file.
  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const refused: string[] = [];
    const accepted: File[] = [];

    for (const file of incoming) {
      if (!ALLOWED_PHOTO_EXTENSIONS.includes(extensionOf(file.name))) {
        refused.push(`"${file.name}" isn't a JPG, PNG or WebP image.`);
      } else if (file.size > MAX_PHOTO_BYTES) {
        refused.push(`"${file.name}" is larger than 10 MB.`);
      } else if (
        // Same file picked again (name + size + modified time match).
        files.some(
          (p) =>
            p.name === file.name &&
            p.size === file.size &&
            p.lastModified === file.lastModified,
        )
      ) {
        continue;
      } else {
        accepted.push(file);
      }
    }

    const fitting = accepted.slice(0, Math.max(0, roomLeft));
    if (fitting.length < accepted.length) {
      refused.push(
        `A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos, so ${
          accepted.length - fitting.length
        } weren't added.`,
      );
    }

    setProblems(refused);
    if (fitting.length > 0) onFilesChange([...files, ...fitting]);
  }

  function removeFile(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
    setProblems([]);
  }

  const hasPhotos = existingCount + files.length > 0;

  return (
    <section aria-labelledby="photos-label" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <PaddyLabel id="photos-label" htmlFor="photos-input">
            Photos
          </PaddyLabel>
          <p className="text-subtle-foreground text-[13px] leading-[1.6]">
            Max file size is 10 MB. Supported file types are .jpg, .png and .webp.
          </p>
        </div>
        <span className="text-muted-foreground shrink-0 pt-0.5 text-xs">
          {photoCountLabel(existingCount, files.length)}
        </span>
      </div>

      {/* Already-uploaded photos (edit mode only — a new listing has
          none until its first save). */}
      {listingId !== undefined && existingCount > 0 && (
        <PhotoManager listingId={listingId} photos={existingPhotos} />
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        disabled={roomLeft <= 0}
        className={cn(
          "bg-field border-field-dashed flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-8 py-6 text-center outline-none transition-[border-color,box-shadow,background-color]",
          "hover:border-ring focus-visible:border-ring focus-visible:shadow-[0_0_0_1px_#fff,0_0_0_3px_color-mix(in_srgb,var(--ring)_60%,transparent)]",
          "disabled:text-disabled-foreground disabled:cursor-not-allowed disabled:hover:border-field-dashed",
          dragging && "border-ring bg-muted",
          // Figma's area is 302px tall; once photos are showing it
          // shrinks so the thumbnails stay in view.
          hasPhotos ? "min-h-28" : "min-h-44 md:min-h-[302px]",
        )}
      >
        <span className="text-subtle-foreground flex items-center gap-2 text-[13px] leading-5 font-medium">
          <ArrowDownTrayIcon />
          {roomLeft <= 0 ? "Photo limit reached" : "Import files"}
        </span>
        <span className="text-muted-foreground text-[13px] leading-5">
          {roomLeft <= 0
            ? `A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos.`
            : "Drag and drop files here or click to upload"}
        </span>
      </button>
      <input
        ref={inputRef}
        id="photos-input"
        type="file"
        multiple
        accept={ACCEPT}
        onChange={(e) => {
          // FileList isn't a real array — Array.from gives .map/.filter.
          addFiles(Array.from(e.target.files ?? []));
          // Reset so picking the SAME file again still fires onChange.
          e.target.value = "";
        }}
        className="sr-only"
        tabIndex={-1}
      />

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive space-y-0.5 text-[13px] leading-5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="bg-surface group relative aspect-square overflow-hidden rounded-lg"
            >
              <FileImage file={file} alt={file.name} className="h-full w-full object-cover" />
              {/* The backend makes the first photo of a listing's first
                  upload its cover. */}
              {existingCount === 0 && i === 0 && (
                <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Cover
                </span>
              )}
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${file.name}`}
                className="absolute top-1.5 right-1.5 rounded-full bg-black/70 p-1 text-white transition hover:bg-black focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
              <p className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-[11px] text-white">
                {file.name}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// "3 uploaded · 2 to upload" — counts photos already on the listing
// (edit mode) as well as freshly picked ones.
export function photoCountLabel(uploaded: number, picked: number): string {
  if (uploaded === 0 && picked === 0) return "No photos yet";
  const parts = [];
  if (uploaded > 0) parts.push(`${uploaded} uploaded`);
  if (picked > 0) parts.push(`${picked} to upload`);
  return parts.join(" · ");
}
