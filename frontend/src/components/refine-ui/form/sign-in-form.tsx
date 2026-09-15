"use client";

import { useState } from "react";

import { CircleHelp } from "lucide-react";

import {
  useLogin,
  useRefineOptions,
  useLink,
  useNotification,
} from "@refinedev/core";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CredentialResponse, GoogleLogin } from "@react-oauth/google";
import { useForm } from "react-hook-form";
import { SignInFormValue, signInSchema } from "@schemas/auth.schema";

export const SignInForm = () => {
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const Link = useLink();

  const { open } = useNotification();

  const { title } = useRefineOptions();

  const { mutate: login } = useLogin();

  const {
    register: registerField,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const handleSignIn = (data: SignInFormValue) => {
    login({
      email: data.email,
      password: data.password,
    });
  };

  const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
    if (credentialResponse.credential) {
      login({
        providerName: "google",
        token: credentialResponse.credential,
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
      <div className={cn("flex", "items-center", "justify-center")}>
        {title.icon && (
          <div
            className={cn("text-foreground", "[&>svg]:w-12", "[&>svg]:h-12")}
          >
            {title.icon}
          </div>
        )}
      </div>

      <Card className={cn("sm:w-[456px]", "p-12", "mt-6")}>
        <CardHeader className={cn("px-0")}>
          <CardTitle
            className={cn(
              "text-blue-600",
              "dark:text-blue-400",
              "text-3xl",
              "font-semibold",
            )}
          >
            Signin
          </CardTitle>
          <CardDescription
            className={cn("text-muted-foreground", "font-medium")}
          >
            Welcome back
          </CardDescription>
        </CardHeader>

        <Separator />

        <CardContent className={cn("px-0")}>
          <form onSubmit={handleSubmit(handleSignIn)}>
            <div className={cn("flex", "flex-col", "gap-2")}>
              <Label htmlFor="email">Email</Label>
              <Input
                {...registerField("email")}
                id="email"
                type="email"
                placeholder=""
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>
            <div
              className={cn("relative", "flex", "flex-col", "gap-2", "mt-6")}
            >
              <Label htmlFor="password">Password</Label>
              <InputPassword
                {...registerField("password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {errors.password && (
                <p className="text-sm text-red-500">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div
              className={cn(
                "flex items-center justify-between",
                "flex-wrap",
                "gap-2",
                "mt-4",
              )}
            >
              <div className={cn("flex items-center", "space-x-2")}>
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) =>
                    setRememberMe(checked === "indeterminate" ? false : checked)
                  }
                />
                <Label htmlFor="remember">Remember me</Label>
              </div>
              <Link
                to="/forgot-password"
                className={cn(
                  "text-sm",
                  "flex",
                  "items-center",
                  "gap-2",
                  "text-primary hover:underline",
                  "text-blue-600",
                  "dark:text-blue-400",
                )}
              >
                <span>Forgot password</span>
                <CircleHelp className={cn("w-4", "h-4")} />
              </Link>
            </div>

            {/* Action button group */}
            <div className="flex flex-col gap-4 mt-4">
              <Button type="submit" size="lg" className={cn("w-full")}>
                Signin
              </Button>
              <div className={cn("flex flex-col")}>
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
                    <div className="absolute inset-0 opacity-0 cursor-pointer overflow-hidden [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:max-w-full">
                      <GoogleLogin
                        onSuccess={(credentialResponse) => {
                          handleGoogleLogin(credentialResponse);
                        }}
                        onError={() => {
                          open?.({
                            type: "error",
                            message: "Google Signin Failed",
                            description:
                              "Could not retrieve your identity token from Google.",
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </CardContent>

        <Separator />

        <CardFooter>
          <div className={cn("w-full", "text-center text-sm")}>
            <span className={cn("text-sm", "text-muted-foreground")}>
              No account?
            </span>
            <Link
              to="/register"
              className={cn(
                "text-green-600",
                "dark:text-green-400",
                "font-semibold",
                "underline",
              )}
            >
              Signup
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

SignInForm.displayName = "SignInForm";
