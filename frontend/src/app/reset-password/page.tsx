import { Suspense } from "react";
import { Loader2 } from "lucide-react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { authServer } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string; token?: string }>;
}) {
  const data = await getData();
  const params = await searchParams;
  const isConfirmLink = Boolean(params.uid && params.token);

  // Only bounce an already-authenticated visitor away from the plain
  // "request a reset" form. A CONFIRM link (?uid&?token, the one the
  // backend emails) must stay reachable even for a signed-in browser
  // — e.g. they requested a reset, then logged back in from another
  // tab before clicking the email link.
  if (data.authenticated && !isConfirmLink) {
    redirect(data?.redirectTo || "/dashboard");
    // Same reasoning as login/page.tsx and register/page.tsx — "/"
    // is now the public discovery hub.
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <Loader2 className="size-8 animate-spin" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

async function getData() {
  const { authenticated, redirectTo } = await authServer.check();

  return {
    authenticated,
    redirectTo,
  };
}
