import { ForgotPasswordForm } from "@/components/refine-ui/form/forgot-password-form";
import { authProviderServer } from "@providers/auth-provider/auth-provider.server";
import { redirect } from "next/navigation";

export default async function ForgotPassword() {
  const data = await getData();

  if (data.authenticated) {
    redirect(data?.redirectTo || "/dashboard");
    // Same reasoning as login/register/page.tsx — "/" is now the
    // public hub, not a session-aware landing spot.
  }

  return <ForgotPasswordForm />;
}

async function getData() {
  const { authenticated, redirectTo, error } = await authProviderServer.check();

  return {
    authenticated,
    redirectTo,
    error,
  };
}
