"use client";

import { useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Search, UserPlus } from "lucide-react";

import { PaddyBadge } from "@/components/paddy-badge";
import { PaddyButton } from "@/components/paddy-button";
import { useApiInvalidate, useApiList } from "@/hooks/use-api";
import { errorMessage } from "@/lib/api";
import { ApiError, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { FormRow, INPUT_CLASS } from "./form-parts";

// Step 1 for staff and admins only (Phase 2, field sales): whose home is
// this? Staff fill this in standing in the property, on a phone, so it's
// one search box, results as big tappable cards, and a short "New
// landlord" form for someone paddy hasn't met yet.
//
// Contract C4, all staff/admin-only:
//   GET  /accounts/landlords/?search=  up to 20, newest first when empty
//   POST /accounts/landlords/          creates the account, emails the invite
//   POST /accounts/landlords/<user id>/resend-invite/
// A landlord made here has no password until they open the invite, which
// is what "Invite pending" (has_claimed false) means.

export type StaffLandlord = {
  /** The landlord's user id (resend-invite takes this one). */
  id: number;
  /** What POST /listings/ takes as landlord_profile_id. */
  landlord_profile_id: number;
  full_name: string;
  email: string;
  phone: string;
  username: string;
  has_claimed: boolean;
};

export function LandlordStep({
  selected,
  onSelect,
  missing,
}: {
  selected: StaffLandlord | null;
  onSelect: (landlord: StaffLandlord | null) => void;
  /** Next was pressed with nobody chosen. */
  missing: boolean;
}) {
  const [creating, setCreating] = useState(false);

  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <LandlordCard landlord={selected} selected />
        <PaddyButton
          variant="secondary"
          size="xl"
          onClick={() => onSelect(null)}
          className="max-md:w-full md:self-start"
        >
          Choose a different landlord
        </PaddyButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {missing && (
        <p role="alert" className="text-destructive text-[13px] leading-5">
          Choose the landlord this home belongs to, or add a new one.
        </p>
      )}
      {creating ? (
        <NewLandlordForm
          onCreated={(landlord) => {
            // "Choose a different landlord" then starts from the search.
            setCreating(false);
            onSelect(landlord);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <LandlordSearch onSelect={onSelect} onNew={() => setCreating(true)} />
      )}
    </div>
  );
}

function LandlordSearch({
  onSelect,
  onNew,
}: {
  onSelect: (landlord: StaffLandlord) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    // Wait for a pause in typing: one request per word, not per letter,
    // on a patchy mobile connection.
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data, isPending, isError, isPlaceholderData } = useApiList<StaffLandlord>(
    "accounts/landlords",
    {
      filters: query ? [{ field: "search", value: query }] : undefined,
      // Keep the last results on screen while the next search loads.
      queryOptions: { placeholderData: keepPreviousData },
    },
  );
  const landlords = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Find the landlord" description="Name, phone number or email.">
        {({ id }) => (
          <div className="relative">
            <Search
              aria-hidden
              className="text-field-placeholder pointer-events-none absolute top-4 left-4 size-6"
              strokeWidth={2}
            />
            <input
              id={id}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Ama Mensah"
              autoComplete="off"
              enterKeyHint="search"
              className={cn(INPUT_CLASS, "pl-12")}
            />
          </div>
        )}
      </FormRow>

      <PaddyButton
        variant="secondary"
        size="xl"
        leftIcon={UserPlus}
        onClick={onNew}
        className="max-md:w-full md:self-start"
      >
        New landlord
      </PaddyButton>

      <div aria-live="polite" aria-busy={isPending || isPlaceholderData}>
        {isError ? (
          <p className="text-destructive text-[13px] leading-5">
            Couldn&apos;t load landlords. Check your connection and try again.
          </p>
        ) : isPending ? (
          <p className="text-muted-foreground text-[13px] leading-5">Loading landlords…</p>
        ) : landlords.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-5">
            {query
              ? `No landlord matches "${query}". Add them with New landlord.`
              : "No landlords yet. Add one with New landlord."}
          </p>
        ) : (
          <ul className={cn("flex flex-col gap-2", isPlaceholderData && "opacity-60")}>
            {landlords.map((landlord) => (
              <li key={landlord.id}>
                <LandlordCard landlord={landlord} onSelect={() => onSelect(landlord)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// One landlord, as a card. The name/contact area is the tap target for
// choosing them; "Resend invite" is its own button beside it (a button
// can't sit inside another button).
function LandlordCard({
  landlord,
  selected = false,
  onSelect,
}: {
  landlord: StaffLandlord;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const details = (
    <>
      <span className="text-foreground block truncate text-base leading-6 font-medium">
        {landlord.full_name}
      </span>
      <span className="text-muted-foreground block truncate text-[13px] leading-5">
        {[landlord.phone, landlord.email].filter(Boolean).join(" · ")}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        selected ? "border-black ring-1 ring-black" : "border-field-border",
      )}
    >
      <div className="flex items-center gap-3">
        {onSelect ? (
          <button
            type="button"
            onClick={onSelect}
            className="hover:bg-muted focus-visible:ring-ring -m-1 min-h-12 min-w-0 flex-1 rounded-md p-1 text-left outline-none focus-visible:ring-2"
          >
            {details}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{details}</div>
        )}
        {selected && (
          <Check className="size-5 shrink-0" strokeWidth={2.5} aria-label="Selected" />
        )}
      </div>
      {!landlord.has_claimed && (
        <div className="flex flex-wrap items-center gap-2">
          <PaddyBadge state="warning" className="h-7">
            Invite pending
          </PaddyBadge>
          <ResendInviteButton landlord={landlord} />
        </div>
      )}
    </div>
  );
}

function ResendInviteButton({ landlord }: { landlord: StaffLandlord }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function resend() {
    setState("sending");
    try {
      await apiPost(`/accounts/landlords/${landlord.id}/resend-invite/`);
      setState("sent");
      toast.success("Invite sent again", { description: `To ${landlord.email}` });
    } catch (err) {
      setState("idle");
      toast.error(
        // Throttled on the backend, so nobody's inbox gets flooded.
        err instanceof ApiError && err.statusCode === 429
          ? "Too many invites sent for now. Try again later."
          : errorMessage(err, "Couldn't resend the invite. Try again."),
      );
    }
  }

  return (
    <PaddyButton
      variant="secondary"
      size="sm"
      onClick={resend}
      isLoading={state === "sending"}
      disabled={state === "sent"}
    >
      {state === "sent" ? "Invite sent" : "Resend invite"}
    </PaddyButton>
  );
}

type NewLandlordValues = { first_name: string; last_name: string; email: string; phone: string };

const NEW_LANDLORD_FIELDS: {
  name: keyof NewLandlordValues;
  label: string;
  type: string;
  autoComplete: string;
  inputMode?: "email" | "tel";
}[] = [
  { name: "first_name", label: "First name", type: "text", autoComplete: "off" },
  { name: "last_name", label: "Last name", type: "text", autoComplete: "off" },
  { name: "phone", label: "Phone", type: "tel", autoComplete: "off", inputMode: "tel" },
  { name: "email", label: "Email", type: "email", autoComplete: "off", inputMode: "email" },
];

// Not a <form>: it sits inside the listing form, and forms can't nest.
function NewLandlordForm({
  onCreated,
  onCancel,
}: {
  onCreated: (landlord: StaffLandlord) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<NewLandlordValues>({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useApiInvalidate();

  async function create() {
    const body = {
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
    };
    if (Object.values(body).some((v) => !v)) {
      setError("Fill in all four fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const landlord = await apiPost<StaffLandlord>("/accounts/landlords/", body);
      void invalidate("accounts/landlords");
      toast.success("Landlord added", {
        description: `We emailed ${landlord.email} a link to set their password.`,
      });
      onCreated(landlord);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "email_taken"
          ? "A paddy account already uses this email. Search for the landlord instead."
          : errorMessage(err, "Couldn't add the landlord. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-subtle-foreground text-[13px] leading-[1.6]">
        They get an email with a link to set a password and manage their home.
      </p>
      <div className="grid grid-cols-2 gap-4 md:gap-8">
        {NEW_LANDLORD_FIELDS.map((field) => (
          <FormRow
            key={field.name}
            label={field.label}
            className={field.name === "email" ? "col-span-2" : undefined}
          >
            {({ id }) => (
              <input
                id={id}
                type={field.type}
                inputMode={field.inputMode}
                autoComplete={field.autoComplete}
                value={values[field.name]}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                className={INPUT_CLASS}
              />
            )}
          </FormRow>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-[13px] leading-5">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <PaddyButton
          variant="secondary"
          size="xl"
          onClick={onCancel}
          disabled={busy}
          className="max-md:flex-1"
        >
          Back to search
        </PaddyButton>
        <PaddyButton size="xl" onClick={create} isLoading={busy} className="max-md:flex-1">
          Add landlord
        </PaddyButton>
      </div>
    </div>
  );
}
