"use client";

import { forwardRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarDays,
  Check,
  Loader2,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMe } from "@/hooks/use-auth";
import { authedFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnlockCheckout } from "./unlock-cta";

export type LandlordContact = { phone?: string | null; email?: string | null } | null;

// Figma booking card (Property Details 171:2635): price + commitment,
// "Reserve a viewing slot" field, neutral "Message Landlord" button and
// the dark primary button, with the trust line underneath.
//
// Decisions (Kelvin, 2026-09-24):
// - Primary button = pay-to-unlock (Figma showed the rent as its label;
//   rent is paid off-platform, so the action is the unlock).
// - "Message Landlord" = reveal the unlocked phone/email (no in-app
//   messaging backend); while locked it points at the unlock.
// - Trust copy reworded so it never implies paddy handles rent.
export const BookingCard = forwardRef<
  HTMLDivElement,
  {
    listingId: number | string;
    priceLabel: string | null;
    advancePeriod: string | null;
    isUnlocked: boolean;
    isAuthenticated: boolean;
    contact: LandlordContact;
    contactOpen: boolean;
    onMessageLandlord: () => void;
    /** false = price and commitment only — the landlord previewing their
     *  own listing in the dashboard has nothing to unlock or book. */
    showRenterActions?: boolean;
  }
>(function BookingCard(
  {
    listingId,
    priceLabel,
    advancePeriod,
    isUnlocked,
    isAuthenticated,
    contact,
    contactOpen,
    onMessageLandlord,
    showRenterActions = true,
  },
  ref,
) {
  const router = useRouter();
  const { starting, startError, startUnlock } = useUnlockCheckout(listingId);

  const commitment =
    advancePeriod === "6_months"
      ? "6 months commitment"
      : advancePeriod === "1_year"
        ? "1 year commitment"
        : "No advance required";

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={ref}
        className="w-full space-y-3 rounded-xl bg-white p-3 pb-4 shadow-[0_4px_13.8px_rgba(0,0,0,0.1)]"
      >
        <div className="space-y-0.5 px-0.5">
          {priceLabel && (
            <p className="text-xl font-semibold tracking-tight text-black/80">{priceLabel}</p>
          )}
          <p className="text-xs font-medium text-black/70">{commitment}</p>
        </div>

        {showRenterActions && (
          <div className="space-y-2.5">
            <ViewingSlotPicker
              listingId={listingId}
              isUnlocked={isUnlocked}
              onUnlock={startUnlock}
            />

            <button
              type="button"
              onClick={onMessageLandlord}
              aria-expanded={contactOpen}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.08)] transition hover:bg-zinc-200 active:scale-[0.98]"
            >
              <MessageCircle className="size-4" />
              Message Landlord
            </button>

            {isUnlocked ? (
              <p className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
                <Check className="size-4" />
                Contact & address unlocked
              </p>
            ) : isAuthenticated ? (
              <button
                type="button"
                onClick={startUnlock}
                disabled={starting}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white/90 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_0_0_1px_#18181b,inset_0_0.75px_0_rgba(255,255,255,0.2)] transition hover:bg-zinc-900 active:scale-[0.98] disabled:opacity-70"
              >
                {starting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LockKeyhole className="size-4" />
                )}
                {starting ? "Starting checkout…" : "Unlock contact & address"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/login")}
                // No return-to-listing after login yet: login always lands
                // on /dashboard (see useLogin in hooks/use-auth.ts).
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white/90 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_0_0_1px_#18181b] transition hover:bg-zinc-900 active:scale-[0.98]"
              >
                <LockKeyhole className="size-4" />
                Sign in to unlock
              </button>
            )}
            {startError && <p className="text-destructive text-xs">{startError}</p>}

            {contactOpen && isUnlocked && <ContactReveal contact={contact} />}
          </div>
        )}
      </div>

      <TrustNote />
    </div>
  );
});

export function TrustNote({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-[230px] flex-col items-center gap-1.5 text-center", className)}>
      <ShieldCheck className="size-4 text-black/80" />
      <p className="text-[11px] leading-relaxed font-medium text-black/70">
        Only pay unlock fees through paddy. Never send rent or a deposit
        before you&apos;ve viewed the home in person.
      </p>
    </div>
  );
}

// Unlocked phone/email from ListingSerializer.landlord_contact — the
// backend only returns it once the viewer has access, so this never
// renders gated data on its own.
function ContactReveal({ contact }: { contact: LandlordContact }) {
  const phone = contact?.phone?.trim() || null;
  const email = contact?.email?.trim() || null;
  const whatsapp = phone ? phone.replace(/[^\d]/g, "").replace(/^0/, "233") : null;

  if (!phone && !email) {
    return (
      <p className="animate-in fade-in slide-in-from-top-1 rounded-md bg-zinc-50 p-3 text-xs text-black/70">
        The landlord hasn&apos;t added contact details yet.
      </p>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-1.5 rounded-md bg-zinc-50 p-2 duration-200">
      {phone && (
        <a
          href={`tel:${phone}`}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
        >
          <Phone className="size-4" /> {phone}
        </a>
      )}
      {whatsapp && (
        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
        >
          <MessageCircle className="size-4" /> WhatsApp
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          className="flex items-center gap-2 truncate rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
        >
          <Mail className="size-4 shrink-0" /> <span className="truncate">{email}</span>
        </a>
      )}
    </div>
  );
}

// Viewing slots offered in the picker. Staff confirm or reschedule
// every request (Viewing.status starts at "requested"), so these are
// preferences, not guaranteed availability.
const SLOT_TIMES = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];

// "Reserve a viewing slot" — POST /viewings/ {listing, scheduled_at}.
// Renter-only on the backend (perform_create 403s everyone else), and
// the backend emails the renter a confirmation with an .ics invite.
// Viewings require an unlocked listing (Kelvin's 2026-09 decision — the
// invite contains the precise address), so a locked listing offers the
// unlock checkout instead of the calendar. The backend enforces this too
// (403 code "listing_not_unlocked"); this just avoids a dead-end click.
function ViewingSlotPicker({
  listingId,
  isUnlocked,
  onUnlock,
}: {
  listingId: number | string;
  isUnlocked: boolean;
  onUnlock: () => void;
}) {
  const router = useRouter();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date | undefined>();
  const [time, setTime] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requested, setRequested] = useState<Date | null>(null);

  const isRenter = me?.role === "renter";
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  function onOpenChange(next: boolean) {
    if (next && !me) {
      toast("Sign in to book a viewing", {
        action: { label: "Sign in", onClick: () => router.push("/login") },
      });
      return;
    }
    if (next && !isRenter) {
      toast("Only renter accounts can book viewings.");
      return;
    }
    if (next && !isUnlocked) {
      toast("Unlock this home to book a viewing", {
        description: "Viewings include the exact address, so they open up once you unlock.",
        action: { label: "Unlock", onClick: onUnlock },
      });
      return;
    }
    setOpen(next);
  }

  async function submit() {
    if (!day || !time) return;
    const [h, m] = time.split(":").map(Number);
    const when = new Date(day);
    when.setHours(h, m, 0, 0);
    // Quick client-side check for a nicer message; the backend also
    // rejects past times (ViewingSerializer.validate_scheduled_at).
    if (when.getTime() <= Date.now()) {
      toast.error("Pick a time in the future.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authedFetch("/viewings/", {
        method: "POST",
        json: { listing: listingId, scheduled_at: when.toISOString() },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? "Could not request this viewing");
      }
      setRequested(when);
      setOpen(false);
      toast.success("Viewing requested", {
        description: `${format(when, "EEE d MMM, h:mm a")} — we'll email you once staff confirm.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not request this viewing");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md border border-[#d9d9d9] px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition hover:border-zinc-400"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium text-black">
              {requested ? "Viewing requested" : "Reserve a viewing slot"}
            </span>
            <span className="block truncate text-xs font-medium text-black/40">
              {requested
                ? format(requested, "EEE d MMM, h:mm a")
                : day && time
                  ? `${format(day, "d/M/yyyy")} · ${time}`
                  : "Pick a date"}
            </span>
          </span>
          {requested ? (
            <Check className="size-4 text-emerald-600" />
          ) : (
            <CalendarDays className="size-4 text-black/70" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end">
        <Calendar
          mode="single"
          selected={day}
          onSelect={setDay}
          disabled={{ before: tomorrow }}
          initialFocus
        />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {SLOT_TIMES.map((slot) => (
            <button
              key={slot}
              type="button"
              aria-pressed={time === slot}
              onClick={() => setTime(slot)}
              className={cn(
                "rounded-md border px-2 py-1.5 text-xs font-medium transition",
                time === slot ? "border-black bg-black text-white" : "hover:bg-zinc-100",
              )}
            >
              {slot}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!day || !time || submitting}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-900 disabled:opacity-50"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Request viewing
        </button>
        <p className="mt-2 max-w-[17rem] text-[11px] text-black/50">
          paddy staff confirm every request before it&apos;s booked.
        </p>
      </PopoverContent>
    </Popover>
  );
}
