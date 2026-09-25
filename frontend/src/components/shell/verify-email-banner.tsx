"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";

import { useMe } from "@/hooks/use-auth";
import { apiPost } from "@/lib/api-client";
import { errorMessage } from "@/lib/api";

// Shown across the dashboard until the signed-in user has verified their
// email. Paying (unlocks, subscriptions), creating listings and booking
// viewings all require a verified email (backend
// accounts/permissions.py), so this tells people WHY those actions will
// refuse them, and gives them a way to get a fresh link.
export function VerifyEmailBanner() {
  const { data: me } = useMe();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Nothing to show while loading, when logged out, or once verified.
  if (!me || me.is_verified !== false) return null;

  async function resend() {
    setSending(true);
    try {
      // POST /accounts/verify-email/resend/ — always emails the signed-in
      // user's own address; there's no email field to fill in.
      await apiPost("/accounts/verify-email/resend/");
      setSent(true);
      toast.success("Verification email sent", {
        description: `Check ${me?.email ?? "your inbox"} for the link.`,
      });
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the email. Try again shortly."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <MailWarning className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        Verify your email to unlock homes, create listings and book viewings.
        {me.email ? <> We sent a link to <strong>{me.email}</strong>.</> : null}
      </p>
      <button
        type="button"
        onClick={resend}
        disabled={sending || sent}
        className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-950 disabled:opacity-60"
      >
        {sent ? "Email sent" : sending ? "Sending…" : "Resend email"}
      </button>
    </div>
  );
}
