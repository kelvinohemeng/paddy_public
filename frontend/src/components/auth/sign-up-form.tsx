"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useRegister } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputPassword } from "@/components/auth/input-password";
import { PaddyButton } from "@/components/paddy-button";
import { AuthSplitLayout } from "@/components/auth-split-layout";
import { GoogleIcon } from "@/components/google-icon";
import { cn } from "@/lib/utils";
import { CredentialResponse, GoogleLogin } from "@react-oauth/google";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SignUpFormValues, signUpSchema } from "@schemas/auth.schema";

// Spec: Figma "Auth" section → Signup (relay 173:19800 380x900
// card-only, 173:18633 full-page split layout, error states
// 173:19423 / 173:19552). Fields per Figma: First Name, Last Name,
// Password, Confirm Password, Role Card x2 (Landlord/Renter).
//
// Email field: NOT present in Figma's frame, kept anyway per
// Kelvin's explicit call 2026-09-23 — the backend's verify-email
// flow (backend/accounts/views.py) requires an email on
// RegisterSerializer, so dropping it would break account creation
// entirely, not just look different from the design.
//
// Role selection: REMOVED from this form (2026-09-23). Kelvin
// identified that Login (and Google sign-in) could bypass Signup's
// role picker entirely, leaving a user authenticated with no role
// set. Backend confirmed `role` is now optional at registration
// (User.role nullable, no default) and added
// `POST /accounts/onboarding/` as the single one-time role-setting
// call, fronted by the /onboarding screen (see
// app/onboarding/page.tsx) — not just this form. NOTE: no automatic
// post-login funnel to /onboarding exists yet (neither the old
// auth-provider nor hooks/use-auth implements one); that gap
// predates this change.

export const SignUpForm = () => {
  const { mutate: register, isPending } = useRegister();

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const handleSignUp = (data: SignUpFormValues) => {
    if (isPending) return;
    if (data.password !== data.confirmPassword) {
      toast.error("Passwords don't match", {
        description:
          "Please make sure both password fields contain the same value.",
      });
      return;
    }

    register(
      {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
      },
      {
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleGoogleSignUp = async (credentialResponse: CredentialResponse) => {
    if (credentialResponse.credential) {
      register(
        {
          providerName: "google",
          token: credentialResponse.credential,
        },
        {
          onError: (err) => toast.error(err.message),
        },
      );
    }
  };

  return (
    <AuthSplitLayout>
      <h1 className="mb-6 text-[28px] font-semibold text-[#111111]">
        Create an account
      </h1>

      <form onSubmit={handleSubmit(handleSignUp)} className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="firstName" className="text-sm font-medium">
              First Name
            </Label>
            <Input id="firstName" type="text" {...registerField("firstName")} />
            {errors.firstName && (
              <p className="text-sm text-red-500">{errors.firstName.message}</p>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="lastName" className="text-sm font-medium">
              Last Name
            </Label>
            <Input id="lastName" type="text" {...registerField("lastName")} />
            {errors.lastName && (
              <p className="text-sm text-red-500">{errors.lastName.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Email
          </Label>
          <Input id="email" type="email" {...registerField("email")} />
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

        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className="text-sm font-medium">
            Confirm Password
          </Label>
          <InputPassword
            {...registerField("confirmPassword")}
            id="confirmPassword"
          />
          {errors.confirmPassword && (
            <p className="text-sm text-red-500">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <div className="relative w-full">
            <PaddyButton
              variant="secondary"
              size="lg"
              type="button"
              className="w-full"
              isLoading={isPending}
            >
              <GoogleIcon className="size-5" />
              Signup with Google
            </PaddyButton>
            <div className="absolute inset-0 cursor-pointer overflow-hidden opacity-0 [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:max-w-full">
              <GoogleLogin
                onSuccess={(credentialResponse) => {
                  handleGoogleSignUp(credentialResponse);
                }}
                onError={() => {
                  toast.error("Google Sign Up Failed", {
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
            Signup
          </PaddyButton>
        </div>
      </form>

      <p className={cn("mt-6 text-center text-sm text-muted-foreground")}>
        Have an account?{" "}
        <Link href="/login" className="font-semibold text-[#17171C] underline">
          Signin
        </Link>
      </p>
    </AuthSplitLayout>
  );
};

SignUpForm.displayName = "SignUpForm";
