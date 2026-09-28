"use client";

import { useMemo, useState } from "react";
import { useApiCreate, useApiList } from "@/hooks/use-api";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Amenity = { id: number; name: string; slug: string };

type AmenityPickerProps = {
  value: number[];
  // The CURRENTLY SELECTED amenity ids — this component is fully
  // "controlled": it never keeps its own separate copy of the
  // selection, it always reflects exactly whatever the parent form
  // hands it, and reports changes back via onChange. Same principle
  // as every other field in the listing form (listing-form/) being driven by
  // react-hook-form's own state, not a local useState.
  onChange: (ids: number[]) => void;
  // Lets a <label htmlFor> point at the trigger button.
  id?: string;
  // Extra classes for the trigger, so a form can match its own fields
  // (the listing form stretches it to Figma's 56px bg-field select).
  triggerClassName?: string;
};

// A searchable multi-select for amenities, with an inline "create new"
// option when the typed search text doesn't match anything existing.
// Landlords browse the SHARED core.Amenity table (visible to every
// landlord, per the actual product decision) and can add a brand new
// amenity on the fly — the backend's own get-or-create logic
// (AmenityViewSet.create, case-insensitive on name) means even if two
// landlords independently "create" the same amenity name, they end up
// pointing at the same underlying row, never a duplicate.

export const AmenityPicker = ({
  value,
  onChange,
  id,
  triggerClassName,
}: AmenityPickerProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Normalize once — guards against string ids sneaking in (e.g. a
  // future edit form hydrating from URL params), which would silently
  // break every .includes() check below via strict-equality mismatch.
  const selectedIds = useMemo(() => value.map(Number), [value]);

  const { data, isLoading, isError, refetch } = useApiList<Amenity>("core/amenities");
  // GET /core/amenities/ — the resource name carries the full backend
  // path. NOTE: AmenityViewSet doesn't implement server-side search
  // (plain ModelViewSet, unrecognized params ignored), so filtering
  // happens CLIENT-SIDE below instead — fine at amenity-list scale
  // (dozens, not thousands, of rows).
  const options = useMemo(
    () =>
      (data?.data ?? []).map((a) => ({ label: a.name, value: a.id })),
    [data],
  );

  const { mutate: createAmenity, isPending: isCreating } =
    useApiCreate<Amenity>("core/amenities");

  const selectedAmenities = options.filter((opt) =>
    selectedIds.includes(Number(opt.value)),
  );

  const trimmedSearch = search.trim();

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase()),
  );

  const exactMatchExists = options.some(
    (opt) => opt.label.toLowerCase() === trimmedSearch.toLowerCase(),
  );

  // THE bug fix: this used to live inside <CommandEmpty>, which cmdk
  // only renders when ZERO items match — so typing a partial match
  // ("pool" when "Swimming Pool" exists) hid the create button with no
  // way to add the genuinely-new amenity. It now renders as its own
  // footer row whenever the typed text isn't an exact match, no matter
  // how many partial matches are listed above it.
  const showCreateRow = trimmedSearch.length > 0 && !exactMatchExists;

  function toggleAmenity(id: number) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((existingId) => existingId !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function handleCreateNew() {
    const name = trimmedSearch;
    if (!name || isCreating) return;
    setCreateError(null);

    createAmenity(
      { name },
      {
        onSuccess: (newAmenity) => {
          // POST /core/amenities/ — the backend's get-or-create logic
          // decides whether this becomes a genuinely new row (201) or
          // returns an existing match (200). Either way, the response
          // is the Amenity itself, carrying a real id we immediately
          // select. Guard against double-adding: the 200 path can
          // return an id that's already selected.
          onChange(
            selectedIds.includes(newAmenity.id)
              ? selectedIds
              : [...selectedIds, newAmenity.id],
          );
          // Immediately select the amenity that was just created (or
          // matched) — the user typed a name expecting it to become
          // part of this listing, not just added to the shared table
          // in the abstract
          setSearch("");
          refetch();
          // Refetch the list so this new/matched amenity shows up in
          // `options` on the next render — without this, a TRULY new
          // amenity would be selected (its id is in `value`) but
          // wouldn't yet render as a visible badge, since
          // selectedAmenities is derived by filtering `options`
        },
        onError: () => {
          setCreateError(
            `Couldn't create "${name}" — check your connection and try again.`,
          );
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between font-normal", triggerClassName)}
          >
            <span className="truncate">
              {isLoading && options.length === 0
                ? "Loading amenities..."
                : selectedAmenities.length > 0
                  ? `${selectedAmenities.length} ${selectedAmenities.length === 1 ? "amenity" : "amenities"} selected`
                  : "Select amenities..."}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            {/* shouldFilter={false} — Command's own built-in filtering
                is disabled deliberately, since filteredOptions above
                already does this manually. Leaving Command's default
                filtering on would double-filter against a DIFFERENT
                matching algorithm than ours, causing confusing
                mismatches between what's typed and what's shown. */}
            <CommandInput
              placeholder="Search or create amenity..."
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setCreateError(null);
              }}
            />
            <CommandList>
              {isLoading && (
                <div className="text-muted-foreground p-4 text-sm">
                  Loading...
                </div>
              )}

              {isError && !isLoading && (
                <div className="p-4 text-sm text-red-500">
                  Couldn&apos;t load amenities — close and reopen to retry.
                </div>
              )}

              <CommandEmpty>No exact match found.</CommandEmpty>

              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={String(option.value)}
                    onSelect={() => toggleAmenity(Number(option.value))}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedIds.includes(Number(option.value))
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>

              {showCreateRow && (
                <div className="border-t p-1">
                  <button
                    type="button"
                    onClick={handleCreateNew}
                    disabled={isCreating}
                    className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {isCreating
                        ? `Creating "${trimmedSearch}"...`
                        : `Create "${trimmedSearch}"`}
                    </span>
                  </button>
                  {createError && (
                    <p className="px-2 pb-1.5 pt-1 text-xs text-red-500">
                      {createError}
                    </p>
                  )}
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedAmenities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedAmenities.map((amenity) => (
            <Badge key={amenity.value} variant="secondary" className="gap-1">
              {amenity.label}
              <button
                type="button"
                onClick={() => toggleAmenity(Number(amenity.value))}
                aria-label={`Remove ${amenity.label}`}
                className="hover:bg-muted-foreground/20 ml-1 rounded-full"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};
