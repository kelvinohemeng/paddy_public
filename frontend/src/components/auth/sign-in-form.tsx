"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { useLogin } from "@/hooks/use-auth";

import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputPassword } from "@/components/auth/input-password";
import { PaddyButton } from "@/components/paddy-button";
import { AuthSplitLayout } from "@/components/auth-split-layout";
import { GoogleIcon } from "@/components/google-icon";
import { cn } from "@/lib/utils";
import { CredentialResponse, GoogleLogin } from "@react-oauth/google";
import { useForm } from "react-hook-form";
import { SignInFormValue, signInSchema } from "@schemas/auth.schema";

// Spec: Figma "Auth" section → Login (relay 173:19647 full-page split
// layout, 173:19908 380x900 card-only). Fields: Email, Password.
// "Remember me" / "Forgot password" / "No account?" links are NOT in
// this Figma frame — kept anyway per Kelvin's call 2026-09-23 (useful
// even if not pictured in this crop). Forgot-password now links to
// /reset-password (new screen, Figma 174:20009) — see that page for
// why it's UI-only (no backend endpoint yet).

export const SignInForm = () => {
  const [rememberMe, setRememberMe] = useState(false);

  const { mutate: login, isPending } = useLogin();

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const handleSignIn = (data: SignInFormValue) => {
    if (isPending) return;
    login(
      { email: data.email, password: data.password },
      {
        // Refine used to toast mutation errors automatically via its
        // notification provider — with plain TanStack that toast is
        // explicit here instead.
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
    if (credentialResponse.credential) {
      login(
        { providerName: "google", token: credentialResponse.credential },
        {
          onError: (err) => toast.error(err.message),
        },
      );
    }
  };

  return (
    <AuthSplitLayout>
      <h1 className="mb-6 text-[28px] font-semibold text-[#111111]">
        Login to your account
      </h1>

      <form onSubmit={handleSubmit(handleSignIn)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Email
          </Label>
          <Input {...registerField("email")} id="email" type="email" />
          {errors.email && (
            <p className="text-sm text-red-500">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <InputPassword {...registerField("password")} id="password" />
          {errors.password && (
            <p className="text-sm text-red-500">{errors.password.message}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) =>
                setRememberMe(checked === "indeterminate" ? false : checked)
              }
            />
            <Label htmlFor="remember" className="text-sm">
              Remember me
            </Label>
          </div>
          <Link
            href="/reset-password"
            className="text-sm font-medium text-[#17171C] underline"
          >
            Forgot password?
          </Link>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <div className="relative w-full">
            <PaddyButton
              variant="secondary"
              size="lg"
              type="button"
              className="w-full"
            >
              <GoogleIcon className="size-5" />
              Log in with Google
            </PaddyButton>
            <div className="absolute inset-0 cursor-pointer overflow-hidden opacity-0 [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:max-w-full">
              <GoogleLogin
                onSuccess={(credentialResponse) => {
                  handleGoogleLogin(credentialResponse);
                }}
                onError={() => {
                  toast.error("Google Signin Failed", {
                    description:
                      "Could not retrieve your identity token from Google.",
                  });
                }}
              />
            </div>
          </div>

          <PaddyButton
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            isLoading={isPending}
          >
            Log in
          </PaddyButton>
        </div>
      </form>

      <p className={cn("mt-6 text-center text-sm text-muted-foreground")}>
        No account?{" "}
        <Link href="/register" className="font-semibold text-[#17171C] underline">
          Signup
        </Link>
      </p>
    </AuthSplitLayout>
  );
};

SignInForm.displayName = "SignInForm";
