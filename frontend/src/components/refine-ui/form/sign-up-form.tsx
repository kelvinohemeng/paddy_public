"use client";

import { useState } from "react";

import {
  useRegister,
  useRefineOptions,
  useLink,
  useNotification,
} from "@refinedev/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { InputPassword } from "@/components/refine-ui/form/input-password";
import { cn } from "@/lib/utils";
import SignUpCardSelect from "@components/paddy-ui/signupCardSelect";
import {
  CredentialResponse,
  GoogleLogin,
  useGoogleLogin,
} from "@react-oauth/google";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SignUpFormValues, signUpSchema } from "@schemas/auth.schema";

export const SignUpForm = () => {
  const [password, setPassword] = useState("");
  // New state, alongside email/password/confirmPassword:
  const [confirmPassword, setConfirmPassword] = useState("");

  const { open } = useNotification();

  const Link = useLink();

  const { title } = useRefineOptions();

  const { mutate: register } = useRegister();

  const {
    register: registerField,
    handleSubmit,
    control: roleControl,
    trigger,
    formState: { errors },
    getValues,
    watch,
  } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "",
    },
  });

  const role = watch("role");

  const handleSignUp = (data: SignUpFormValues) => {
    if (data.password !== data.confirmPassword) {
      open?.({
        type: "error",
        message: "Passwords don't match",
        description:
          "Please make sure both password fields contain the same value.",
      });

      return;
    }

    register({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
      confirmPassword: data.confirmPassword,
      role: data.role,
    });
  };

  const handleGoogleSignUp = async (credentialResponse: CredentialResponse) => {
    const isRoleValid = await trigger(["role"]);
    if (!isRoleValid) return;

    if (credentialResponse.credential) {
      register({
        providerName: "google",
        token: credentialResponse.credential,
        role: getValues("role"),
      });
    }
  };

  return (
    <div
      className={cn(
        "flex",
        "flex-col",
        "items-center",
        "justify-center",
        "px-6",
        "py-8",
        "min-h-svh",
      )}
    >
      <div className={cn("flex items-center justify-center gap-2")}>
        {title.icon && (
          <div className={cn("text-foreground [&>svg]:w-12 [&>svg]:h-12")}>
            {title.icon}
          </div>
        )}
      </div>

      <Card className={cn("sm:w-[456px] p-12 mt-6")}>
        <CardHeader className={cn("px-0")}>
          <CardTitle
            className={cn(
              "text-green-600",
              "dark:text-green-400",
              "text-3xl",
              "font-semibold",
            )}
          >
            Sign up
          </CardTitle>
          <CardDescription className={cn("text-muted-foreground font-medium")}>
            Welcome to lorem ipsum dolor.
          </CardDescription>
        </CardHeader>

        <Separator />

        <CardContent className={cn("px-0")}>
          <form onSubmit={handleSubmit(handleSignUp)} className="space-y-4">
            <div className="flex gap-4">
              <div className={cn("flex flex-col gap-2")}>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder=""
                  {...registerField("firstName")}
                  className={cn("w-full py-4 mt-2")}
                />
                {errors.firstName && (
                  <p className={cn("text-sm text-red-500")}>
                    {errors.firstName.message}
                  </p>
                )}
              </div>
              <div className={cn("flex flex-col gap-2")}>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder=""
                  {...registerField("lastName")}
                  className={cn("w-full py-4 mt-2")}
                />
                {errors.lastName && (
                  <p className={cn("text-sm text-red-500")}>
                    {errors.lastName.message}
                  </p>
                )}
              </div>
            </div>
            <div className={cn("flex flex-col gap-2")}>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder=""
                {...registerField("email")}
                className={cn("w-full py-4 mt-2")}
              />
              {errors.email && (
                <p className={cn("text-sm text-red-500")}>
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className={cn("relative flex flex-col gap-2")}>
              <Label htmlFor="password">Password</Label>
              <InputPassword
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className={cn("relative flex flex-col gap-2 mt-6")}>
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <InputPassword
                {...registerField("confirmPassword")}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {errors.confirmPassword && (
                <p className={cn("text-sm text-red-500")}>
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>
            {/* New JSX block, right after the confirm-password field, before the
            Sign up button: */}
            <div className={cn("flex flex-col gap-2 mt-6")}>
              <p>Sign up as:</p>

              <Controller
                name="role"
                control={roleControl}
                render={({ field }) => (
                  <div className={cn("flex items-center gap-4")}>
                    <SignUpCardSelect
                      role={field.value}
                      setRole={field.onChange}
                      value="renter"
                    />
                    <SignUpCardSelect
                      role={field.value}
                      setRole={field.onChange}
                      value="landlord"
                    />
                  </div>
                )}
              />
              {errors.role && (
                <p className={cn("text-sm text-red-500")}>
                  {errors.role.message}
                </p>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              className={cn(
                "w-full",
                "mt-6",
                "bg-green-600",
                "hover:bg-green-700",
                "text-white",
              )}
            >
              Sign up
            </Button>
            <div className={cn("flex flex-col gap-4 w-full")}>
              <div className={cn("flex")}>
                <div className="relative w-full flex justify-center">
                  <Button
                    variant="outline"
                    className={cn("flex items-center gap-2 w-full")}
                    type="button"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <g clipPath="url(#clip0_173_19624)">
                        <path
                          d="M10.0002 3.95833C11.4752 3.95833 12.7961 4.46667 13.8377 5.45833L16.6919 2.60417C14.9586 0.991667 12.6961 0 10.0002 0C6.09189 0 2.71273 2.24167 1.06689 5.50833L4.39189 8.0875C5.17939 5.71667 7.39189 3.95833 10.0002 3.95833Z"
                          fill="#EA4335"
                        />
                        <path
                          d="M19.575 10.2298C19.575 9.57565 19.5125 8.94232 19.4167 8.33398H10V12.0923H15.3917C15.15 13.3257 14.45 14.3757 13.4 15.084L16.6208 17.584C18.5 15.8423 19.575 13.2673 19.575 10.2298Z"
                          fill="#4285F4"
                        />
                        <path
                          d="M4.3875 11.912C4.1875 11.3078 4.07083 10.6661 4.07083 9.99948C4.07083 9.33281 4.18333 8.69115 4.3875 8.08698L1.0625 5.50781C0.383333 6.85781 0 8.38281 0 9.99948C0 11.6161 0.383333 13.1411 1.06667 14.4911L4.3875 11.912Z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M10 19.9999C12.7 19.9999 14.9708 19.1124 16.6208 17.579L13.4 15.079C12.5042 15.6832 11.35 16.0374 10 16.0374C7.39167 16.0374 5.17917 14.279 4.3875 11.9082L1.0625 14.4874C2.7125 17.7582 6.09167 19.9999 10 19.9999Z"
                          fill="#34A853"
                        />
                      </g>
                      <defs>
                        <clipPath id="clip0_173_19624">
                          <rect width="20" height="20" fill="white" />
                        </clipPath>
                      </defs>
                    </svg>
                    <div>Google</div>
                  </Button>
                  {!role && (
                    <div
                      className="absolute inset-0 cursor-pointer z-10"
                      onClick={() => trigger(["role"])}
                    />
                  )}
                  <div className="absolute inset-0 opacity-0 cursor-pointer overflow-hidden [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:max-w-full">
                    <GoogleLogin
                      onSuccess={(credentialResponse) => {
                        handleGoogleSignUp(credentialResponse);
                      }}
                      onError={() => {
                        open?.({
                          type: "error",
                          message: "Google Sign Up Failed",
                          description:
                            "Could not retrieve your identity token from Google.",
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </form>
        </CardContent>

        <Separator />

        <CardFooter>
          <div className={cn("w-full text-center text-sm")}>
            <span className={cn("text-sm text-muted-foreground")}>
              Have an account?
            </span>
            <Link
              to="/login"
              className={cn(
                "text-blue-600",
                "dark:text-blue-400",
                "font-semibold",
                "underline",
              )}
            >
              Signin
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

SignUpForm.displayName = "SignUpForm";
