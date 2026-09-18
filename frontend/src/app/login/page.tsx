import { SignInForm } from "@/components/refine-ui/form/sign-in-form";
import { authProviderServer } from "@providers/auth-provider/auth-provider.server";
import { redirect } from "next/navigation";

export default async function Login() {
  const data = await getData();

  if (data.authenticated) {
    redirect(data?.redirectTo || "/dashboard");
    // Was "/" — "/" is now the public discovery hub, which isn't a
    // useful landing spot for someone who's already logged in and
    // hit /login directly; send them to their dashboard instead.
  }

  return <SignInForm />;
}

async function getData() {
  const { authenticated, redirectTo, error } = await authProviderServer.check();

  return {
    authenticated,
    redirectTo,
    error,
  };
}
