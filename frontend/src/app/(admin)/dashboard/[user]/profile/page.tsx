"use client";
// Profile ("CV") — one route, every role. Reads come from
// GET /accounts/me/ (useGetIdentity returns the full payload: user
// fields + nested role-specific `profile`).
//
// WRITES — live against backend PR #17 (merged to main):
//   PATCH /accounts/me/
//   - Renter: full_name, preferred_area, school_name, occupation,
//     about_me, preferred_payment_method, amenity_preferences (list of
//     Amenity PKs — [] clears; unknown IDs 400; validated choices 400)
//   - Landlord: full_name, preferred_payout_method (validated).
//     national_id_number / id_verified are NEVER sent — staff-only,
//     silently ignored server-side by design.
//   - Staff: full_name only (permission flags are admin-set).
//   - Unknown/disallowed keys are silently ignored server-side.
// Error shape is always {'error': '...'} — unwrapped below, same as
// use-submit-for-review.ts.

import { useState } from "react";
import { useMe } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AmenityPicker } from "../listings/_components/amenity-picker";
// Shared controlled picker (value: number[], onChange) — owned by the
// listing form, reused here since the write shape is identical (a list
// of Amenity PKs) and it already handles options/create/labels.
import { authedFetch, errorMessage } from "@/lib/api";

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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium break-words">
        {value ?? "—"}
      </span>
    </div>
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
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

const selectClassName =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring";

export default function ProfilePage() {
  const { data: identity, refetch } = useMe();

  if (!identity) {
    return (
      <div className="p-6">
        <p>Loading profile...</p>
      </div>
    );
  }

  // key remounts the editor whenever a DIFFERENT user loads (route param
  // change reuses this component instance) — useState initializers below
  // then seed from the fresh identity with no syncing effect needed.
  return (
    <ProfileEditor key={identity.id} identity={identity} onSaved={refetch} />
  );
}

// Split from the page so the editable fields can seed via useState
// initializers (no setState-in-effect): the key above guarantees a
// fresh mount per user, which is the only time seeding must re-run.
// Post-save freshness comes from the refetch.
function ProfileEditor({
  identity,
  onSaved,
}: {
  identity: any;
  onSaved: () => void;
}) {
  const role: string = identity.role;
  const profile: any = identity.profile ?? {};
  // profile can be null for a mid-signup/edge-case account (backend
  // returns profile: null rather than 500) — seed empties and let the
  // save go through; the backend no-ops .update() on a missing row.

  const [phone, setPhone] = useState(identity.phone ?? "");
  const [fullName, setFullName] = useState(profile.full_name ?? "");

  // Renter CV fields.
  const [preferredArea, setPreferredArea] = useState(
    profile.preferred_area ?? "",
  );
  const [schoolName, setSchoolName] = useState(profile.school_name ?? "");
  const [occupation, setOccupation] = useState(profile.occupation ?? "student");
  const [aboutMe, setAboutMe] = useState(profile.about_me ?? "");
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState(
    profile.preferred_payment_method ?? "momo",
  );
  const [amenityIds, setAmenityIds] = useState<number[]>(() =>
    Array.isArray(profile.amenity_preferences)
      ? profile.amenity_preferences.map(Number).filter((n: number) => !Number.isNaN(n))
      : [],
  );

  // Landlord field.
  const [preferredPayoutMethod, setPreferredPayoutMethod] = useState(
    profile.preferred_payout_method ?? "momo",
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSavedTick(false);

    // Per-role payloads — only keys the backend reads for THIS role.
    // (Extra keys would be silently ignored server-side, but sending
    // exactly the contract keeps the request honest and debuggable.)
    const payload: Record<string, unknown> = {
      phone,
      full_name: fullName,
    };
    if (role === "renter") {
      payload.preferred_area = preferredArea;
      payload.school_name = schoolName;
      payload.occupation = occupation;
      payload.about_me = aboutMe;
      payload.preferred_payment_method = preferredPaymentMethod;
      payload.amenity_preferences = amenityIds;
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
            `Could not save profile (HTTP ${res.status})`,
        );
      }
      await onSaved();
      setSavedTick(true);
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save profile"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Email" value={identity.email} />
          <Row
            label="Role"
            value={<Badge variant="secondary">{role}</Badge>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {role === "renter"
              ? "Renter CV"
              : role === "landlord"
                ? "Landlord profile"
                : role === "staff"
                  ? "Staff profile"
                  : "Profile"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Full name" htmlFor="profile-full-name">
              <Input
                id="profile-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                required
              />
            </Field>

            <Field label="Phone" htmlFor="profile-phone">
              <Input
                id="profile-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
              />
            </Field>

            {role === "renter" && (
              <>
                <Field label="Preferred area" htmlFor="profile-area">
                  <Input
                    id="profile-area"
                    value={preferredArea}
                    onChange={(e) => setPreferredArea(e.target.value)}
                    placeholder="e.g. Osu, Kumasi"
                  />
                </Field>

                <Field label="School" htmlFor="profile-school">
                  <Input
                    id="profile-school"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="School or institution (if any)"
                  />
                </Field>

                <Field label="Occupation" htmlFor="profile-occupation">
                  <select
                    id="profile-occupation"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    className={selectClassName}
                  >
                    {OCCUPATIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="About me" htmlFor="profile-about">
                  <Textarea
                    id="profile-about"
                    value={aboutMe}
                    onChange={(e) => setAboutMe(e.target.value)}
                    placeholder="A short intro landlords see with your enquiries"
                    rows={4}
                  />
                </Field>

                <Field
                  label="Preferred payment method"
                  htmlFor="profile-pay-method"
                >
                  <select
                    id="profile-pay-method"
                    value={preferredPaymentMethod}
                    onChange={(e) => setPreferredPaymentMethod(e.target.value)}
                    className={selectClassName}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Amenity preferences" htmlFor="profile-amenities">
                  <div id="profile-amenities">
                    <AmenityPicker
                      value={amenityIds}
                      onChange={setAmenityIds}
                    />
                  </div>
                </Field>
              </>
            )}

            {role === "landlord" && (
              <Field
                label="Preferred payout method"
                htmlFor="profile-payout-method"
              >
                <select
                  id="profile-payout-method"
                  value={preferredPayoutMethod}
                  onChange={(e) => setPreferredPayoutMethod(e.target.value)}
                  className={selectClassName}
                >
                  {PAYOUT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {saveError && (
              <p className="text-sm text-red-500">{saveError}</p>
            )}
            {savedTick && (
              <p className="text-sm text-green-600">Saved.</p>
            )}
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          </form>

          {(role === "landlord" || role === "staff") && (
            <div className="divide-y pt-4">
              {role === "landlord" && (
                <Row
                  label="ID verified"
                  value={
                    profile.id_verified ? (
                      <Badge>Verified</Badge>
                    ) : (
                      <Badge variant="secondary">Pending verification</Badge>
                    )
                  }
                />
              )}
              {role === "staff" && (
                <>
                  <Row
                    label="Can approve listings"
                    value={profile.can_approve_listings ? "Yes" : "No"}
                  />
                  <Row
                    label="Can host viewings"
                    value={profile.can_host_viewings ? "Yes" : "No"}
                  />
                </>
              )}
            </div>
          )}
          {role === "admin" && (
            <p className="text-muted-foreground pt-4 text-sm">
              Admins have no profile table — account details above are
              all there is.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
