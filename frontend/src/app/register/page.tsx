import { SignUpForm } from "@/components/auth/sign-up-form";
import { authServer } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function Register() {
  const data = await getData();

  if (data.authenticated) {
    redirect(data?.redirectTo || "/dashboard");
    // Same reasoning as login/page.tsx — "/" is now the public hub.
  }

  return <SignUpForm />;
}

async function getData() {
  const { authenticated, redirectTo } = await authServer.check();

  return {
    authenticated,
    redirectTo,
  };
}
