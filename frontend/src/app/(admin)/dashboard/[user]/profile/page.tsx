"use client";
// Profile ("About me", the renter's CV) — one route, every role.
// Figma, read 2026-09-28:
//   181:22659 / 288:8159  view   avatar tile, name, role chip, then
//                                label/value pairs and "Edit Details"
//   181:22494             edit   the same header, then the form and "Save"
// Both sit in the 443px column, 32px between blocks, 10px from a label to
// its value or control.
//
// READS: GET /accounts/me/ (useMe) — user fields plus the nested,
// role-specific `profile`.
//
// WRITES: PATCH /accounts/me/ (backend PR #17):
//   - Renter: full_name, preferred_area, school_name, occupation,
//     about_me, preferred_payment_method, amenity_preferences (list of
//     Amenity PKs — [] clears; unknown IDs 400; validated choices 400)
//   - Landlord: full_name, preferred_payout_method (validated).
//     national_id_number / id_verified are NEVER sent — staff-only,
//     silently ignored server-side by design.
//   - Staff: full_name only (permission flags are admin-set).
//   - Everyone: phone.
//   - Unknown/disallowed keys are silently ignored server-side.
// Error shape is always {'error': '...'}.
//
// Deliberate differences from the frames:
// - First / Last Name: the backend stores ONE full_name. The form splits
//   it at the first space and joins the two back on save, so
//   "Ama Serwaa Mensah" round-trips unchanged.
// - Labels are black at 60%, not Figma's 50%: 50% on the grey panel is
//   under WCAG AA contrast at 12px (same call as the listing card, see
//   listing-card.tsx). One label style for every field (the frame gives
//   First / Last Name a different one).
// - The frame's note says School Name shows only for students, otherwise
//   "What do you do for work". There's no work field in the backend yet,
//   so non-students just don't get the school field.
// - Fields the frames don't draw but the backend has (phone, preferred
//   area and payment method, payout method, ID verification) stay, in
//   the same style, after the ones the frames do draw.

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { useMe } from "@/hooks/use-auth";
import { useApiList } from "@/hooks/use-api";
import { authedFetch, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PaddyBadge } from "@/components/paddy-badge";
import { PaddyButton } from "@/components/paddy-button";
import {
  DashboardMessage,
  DashboardPage,
  PAGE_TITLE_CLASS,
} from "@/components/dashboard-page";
import { AmenityPicker } from "../listings/_components/amenity-picker";
// Shared controlled picker (value: number[], onChange) owned by the
// listing form — reused here since the write shape is identical.

// Choice values mirror the backend TextChoices EXACTLY
// (accounts/models.py) — the server 400s anything else.
const OCCUPATIONS = [
  { value: "student", label: "Student" },
  { value: "professional", label: "Professional" },
  { value: "unemployed", label: "Unemployed" },
  { value: "other", label: "Other" },
] as const;

const PAYMENT_METHODS = [
  { value: "momo", label: "Mobile Money" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

const PAYOUT_METHODS = [
  { value: "momo", label: "Mobile Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

type Option = { readonly value: string; readonly label: string };

function labelOf(options: readonly Option[], value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

// ── Styles, all from the frames ─────────────────────────────────────
// Field label: Plus Jakarta Sans Medium 12, -2% (colour: see header).
const FIELD_LABEL =
  "font-label text-xs leading-[15px] font-medium tracking-[-0.02em] text-black/60";
// Field value (view): Plus Jakarta Sans Medium 14, 160% line height,
// black at 80%.
const FIELD_VALUE =
  "font-label text-sm leading-[1.6] font-medium tracking-[-0.02em] text-black/80";
// Role chip and preference chips (view): white, 0.5px #d9d9d9 edge, 5px
// corners, 6px padding, Plus Jakarta Sans Medium 14.
const CHIP =
  "font-label border-hairline inline-flex items-center rounded-[5px] border-[0.5px] bg-white p-1.5 text-sm leading-none font-medium tracking-[-0.02em] text-black/80";
// Inputs (edit): the Handoff "Text Input" / "Select" at Base size,
// stretched to 40px — white, 6px corners, the Secondary button's ring
// shadow, Inter 13/20, 8px side padding, #71717a placeholder. Focus
// borrows the listing form's ring (1px #3b82f6 + 4px halo at 20%).
// 16px text on phones so iOS doesn't zoom into the field.
const CONTROL = cn(
  "text-foreground placeholder:text-muted-foreground h-10 w-full min-w-0 rounded-md border-0 bg-white px-2 text-base leading-5 outline-none transition-shadow sm:text-[13px]",
  "shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_1px_2px_0_rgb(0_0_0/0.12)]",
  "focus-visible:shadow-[0_0_0_1px_var(--ring),0_0_0_4px_color-mix(in_srgb,var(--ring)_20%,transparent)]",
);

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ["", ""];
  return [parts[0], parts.slice(1).join(" ")];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ProfilePage() {
  const { data: identity, refetch } = useMe();

  if (!identity) {
    return <DashboardMessage loading>Loading your profile…</DashboardMessage>;
  }

  // key remounts everything below when a DIFFERENT user loads (a route
  // param change reuses this component), so the form's useState
  // initializers seed from the fresh identity with no syncing effect.
  return <Profile key={identity.id} identity={identity} refetch={refetch} />;
}

function Profile({
  identity,
  refetch,
}: {
  identity: any;
  refetch: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <DashboardPage width="md">
      <div className="flex flex-col gap-8">
        <ProfileHeader identity={identity} />
        {editing ? (
          <ProfileForm
            identity={identity}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              await refetch();
              setEditing(false);
            }}
          />
        ) : (
          <ProfileDetails identity={identity} onEdit={() => setEditing(true)} />
        )}
      </div>
    </DashboardPage>
  );
}

// Avatar tile (92px, white, 0.5px #d9d9d9 edge, 9px corners, initial in
// Clash Display 22), then 10px down the name and the role chip, 12px apart.
function ProfileHeader({ identity }: { identity: any }) {
  const name: string =
    identity.profile?.full_name?.trim() || identity.email || "Your profile";
  const role: string = identity.role ?? "";

  return (
    <div className="flex flex-col gap-2.5">
      <div
        aria-hidden
        className="border-hairline flex size-[92px] items-center justify-center rounded-[9px] border-[0.5px] bg-white"
      >
        <span className={PAGE_TITLE_CLASS}>{name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-3">
        <h1 className={cn(PAGE_TITLE_CLASS, "max-w-full break-words")}>{name}</h1>
        {role && <span className={CHIP}>{capitalize(role)}</span>}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd className={cn(FIELD_VALUE, "break-words")}>{children}</dd>
    </div>
  );
}

function ProfileDetails({ identity, onEdit }: { identity: any; onEdit: () => void }) {
  const role: string = identity.role;
  const profile: any = identity.profile ?? {};
  const isRenter = role === "renter";

  // Amenity names for the Preferences chips (the profile stores PKs).
  const { data: amenities } = useApiList<{ id: number; name: string }>(
    "core/amenities",
    { enabled: isRenter },
  );
  const preferenceIds: number[] = Array.isArray(profile.amenity_preferences)
    ? profile.amenity_preferences.map(Number)
    : [];
  const preferences = (amenities?.data ?? []).filter((a) =>
    preferenceIds.includes(Number(a.id)),
  );

  const notSet = <span className="text-black/50">Not set</span>;

  return (
    <>
      <dl className="flex flex-col gap-8">
        {isRenter && (
          <>
            <Detail label="About Me">
              {profile.about_me?.trim() ? (
                <span className="whitespace-pre-line">{profile.about_me}</span>
              ) : (
                <span className="text-black/50">
                  Tell landlords a little about yourself
                </span>
              )}
            </Detail>
            <Detail label="Occupation">
              {labelOf(OCCUPATIONS, profile.occupation) ?? notSet}
            </Detail>
            {profile.occupation === "student" && (
              <Detail label="School Name">{profile.school_name || notSet}</Detail>
            )}
            <Detail label="Preferences">
              {preferences.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {preferences.map((a) => (
                    <span key={a.id} className={CHIP}>
                      {a.name}
                    </span>
                  ))}
                </span>
              ) : (
                notSet
              )}
            </Detail>
            <Detail label="Preferred area">{profile.preferred_area || notSet}</Detail>
            <Detail label="Preferred payment">
              {labelOf(PAYMENT_METHODS, profile.preferred_payment_method) ?? notSet}
            </Detail>
          </>
        )}

        {role === "landlord" && (
          <>
            <Detail label="Payout method">
              {labelOf(PAYOUT_METHODS, profile.preferred_payout_method) ?? notSet}
            </Detail>
            <Detail label="ID verification">
              {profile.id_verified ? (
                <PaddyBadge state="success">Verified</PaddyBadge>
              ) : (
                <PaddyBadge state="warning">Pending verification</PaddyBadge>
              )}
            </Detail>
          </>
        )}

        {role === "staff" && (
          <>
            <Detail label="Can approve listings">
              {profile.can_approve_listings ? "Yes" : "No"}
            </Detail>
            <Detail label="Can host viewings">
              {profile.can_host_viewings ? "Yes" : "No"}
            </Detail>
          </>
        )}

        <Detail label="Email">{identity.email}</Detail>
        <Detail label="Phone">{identity.phone || notSet}</Detail>
      </dl>

      <PaddyButton className="self-start" onClick={onEdit}>
        Edit Details
      </PaddyButton>
    </>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}

// Native <select> in the input's style, with the chevron the Figma
// "Select Input Button" draws at the right end.
function SelectControl({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(CONTROL, "cursor-pointer appearance-none pr-9")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="text-subtle-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </div>
  );
}

function ProfileForm({
  identity,
  onSaved,
  onCancel,
}: {
  identity: any;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const role: string = identity.role;
  // profile can be null for a mid-signup / edge-case account (the backend
  // returns profile: null rather than 500) — seed empties and let the
  // save go through; the backend no-ops .update() on a missing row.
  const profile: any = identity.profile ?? {};
  const hasName = role !== "admin"; // admins have no profile table

  const [initialFirst, initialLast] = splitName(profile.full_name ?? "");
  const [firstName, setFirstName] = useState(initialFirst);
  const [lastName, setLastName] = useState(initialLast);
  const [phone, setPhone] = useState(identity.phone ?? "");

  // Renter CV fields.
  const [aboutMe, setAboutMe] = useState(profile.about_me ?? "");
  const [occupation, setOccupation] = useState(profile.occupation ?? "student");
  const [schoolName, setSchoolName] = useState(profile.school_name ?? "");
  const [amenityIds, setAmenityIds] = useState<number[]>(() =>
    Array.isArray(profile.amenity_preferences)
      ? profile.amenity_preferences
          .map(Number)
          .filter((n: number) => !Number.isNaN(n))
      : [],
  );
  const [preferredArea, setPreferredArea] = useState(profile.preferred_area ?? "");
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState(
    profile.preferred_payment_method ?? "momo",
  );

  // Landlord field.
  const [preferredPayoutMethod, setPreferredPayoutMethod] = useState(
    profile.preferred_payout_method ?? "momo",
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    // Per-role payloads — only keys the backend reads for THIS role.
    // (Extra keys would be ignored server-side, but sending exactly the
    // contract keeps the request honest and debuggable.)
    const payload: Record<string, unknown> = { phone };
    if (hasName) {
      payload.full_name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    }
    if (role === "renter") {
      payload.about_me = aboutMe;
      payload.occupation = occupation;
      // Sent unchanged when the field is hidden (non-students), so
      // switching occupation never silently wipes a stored school.
      payload.school_name = schoolName;
      payload.amenity_preferences = amenityIds;
      payload.preferred_area = preferredArea;
      payload.preferred_payment_method = preferredPaymentMethod;
    } else if (role === "landlord") {
      payload.preferred_payout_method = preferredPayoutMethod;
    }

    try {
      const res = await authedFetch("/accounts/me/", {
        method: "PATCH",
        json: payload,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Could not save your profile (HTTP ${res.status})`,
        );
      }
      await onSaved();
      toast.success("Profile saved");
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save your profile"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-8">
      {hasName && (
        // Side by side, 20px apart, as in the frame; stacked on phones.
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="First Name" htmlFor="profile-first-name">
            <input
              id="profile-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First Name"
              autoComplete="given-name"
              required
              className={CONTROL}
            />
          </Field>
          <Field label="Last Name" htmlFor="profile-last-name">
            <input
              id="profile-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last Name"
              autoComplete="family-name"
              className={CONTROL}
            />
          </Field>
        </div>
      )}

      {role === "renter" && (
        <>
          <Field label="About Me" htmlFor="profile-about">
            <textarea
              id="profile-about"
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              placeholder="A short intro landlords see with your enquiries"
              className={cn(CONTROL, "h-auto min-h-[113px] resize-y py-1.5 leading-[1.6]")}
            />
          </Field>

          <Field label="Occupation" htmlFor="profile-occupation">
            <SelectControl
              id="profile-occupation"
              value={occupation}
              onChange={setOccupation}
              options={OCCUPATIONS}
            />
          </Field>

          {occupation === "student" && (
            <Field label="School Name" htmlFor="profile-school">
              <input
                id="profile-school"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="e.g. University of Ghana"
                className={CONTROL}
              />
            </Field>
          )}

          <Field label="Preferences" htmlFor="profile-amenities">
            <AmenityPicker
              id="profile-amenities"
              value={amenityIds}
              onChange={setAmenityIds}
              triggerClassName={cn(
                CONTROL,
                "justify-between font-normal hover:bg-white focus-visible:ring-0",
              )}
            />
          </Field>

          <Field label="Preferred area" htmlFor="profile-area">
            <input
              id="profile-area"
              value={preferredArea}
              onChange={(e) => setPreferredArea(e.target.value)}
              placeholder="e.g. Osu, Kumasi"
              className={CONTROL}
            />
          </Field>

          <Field label="Preferred payment method" htmlFor="profile-pay-method">
            <SelectControl
              id="profile-pay-method"
              value={preferredPaymentMethod}
              onChange={setPreferredPaymentMethod}
              options={PAYMENT_METHODS}
            />
          </Field>
        </>
      )}

      {role === "landlord" && (
        <Field label="Payout method" htmlFor="profile-payout-method">
          <SelectControl
            id="profile-payout-method"
            value={preferredPayoutMethod}
            onChange={setPreferredPayoutMethod}
            options={PAYOUT_METHODS}
          />
        </Field>
      )}

      <Field label="Phone" htmlFor="profile-phone">
        <input
          id="profile-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          autoComplete="tel"
          className={CONTROL}
        />
      </Field>

      {saveError && (
        <p role="alert" className="text-destructive text-[13px] leading-5">
          {saveError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <PaddyButton type="submit" isLoading={saving}>
          Save
        </PaddyButton>
        <PaddyButton variant="transparent" onClick={onCancel} disabled={saving}>
          Cancel
        </PaddyButton>
      </div>
    </form>
  );
}
