"use client";

// Auth state for the app — plain TanStack Query, no framework. This
// replaces the Refine authProvider (login/register/logout/check/
// getIdentity/onError) with the same backend contracts and the same
// token handling, owned here instead of behind Refine's interface:
//
// Token storage: none in the browser. The JWTs live in httpOnly cookies
// that only our Next server reads and writes (lib/auth-cookies.ts), so
// nothing here ever sees a token, and neither can an injected script.
// Signing in, signing in with Google and signing out go through our own
// route handlers (app/api/auth/*), which talk to Django and set or clear
// the cookies. Everything else goes through authedFetch (lib/api.ts).
//
// Endpoints: POST /api/auth/login, /api/auth/google, /api/auth/logout
// (ours), POST /accounts/register/ (Django directly: registering signs
// nobody in, so no tokens are involved), GET /accounts/me/ via
// authedFetch. Field naming: the app speaks camelCase, Django speaks
// snake_case — translation happens at these network boundaries only.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authedFetch } from "@/lib/api";
import { hasSessionHint } from "@/lib/session-hint";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export type Me = {
  id: number | string;
  email?: string;
  role?: string;
  /** URL slug for /dashboard/<username>/…; null until onboarding. */
  username?: string | null;
  profile?: any;
  [key: string]: any;
} | null;

export const ME_QUERY_KEY = ["api", "accounts/me"];

async function fetchMe(): Promise<Me> {
  // This code can't see the httpOnly session cookies, so it checks the
  // readable signed_in hint instead (lib/session-hint.ts). Without it,
  // every logged-out visitor's browser would ask /accounts/me/ on every
  // public page just to be told 401.
  if (!hasSessionHint()) return null;

  // The /api/backend route refreshes an expired access token first, so a
  // signed-in renter on a public page doesn't read as logged out once
  // their 5-minute token runs out. A 401 that still comes back means the
  // session is over, and the route has cleared the cookies, hint included.
  const res = await authedFetch("/accounts/me/");
  if (!res.ok) return null;
  return (await res.json()) as Me;
}

// Our own auth routes (app/api/auth/*). They answer with Django's status
// and error body when sign-in fails, and set the session cookies when it
// works.
async function postAuthRoute(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Identity for nav gates and role checks. No retries: a 401 here means
// "not logged in", not "try again" — retrying would just triple-fire
// failing requests on every page load for logged-out visitors.
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
  });
}

type EmailLogin = { email: string; password: string };
type GoogleAuth = { providerName: "google"; token: string; role?: string };
export type LoginInput = EmailLogin | GoogleAuth;

async function loginRequest(input: LoginInput): Promise<void> {
  if ("providerName" in input && input.providerName === "google") {
    const res = await postAuthRoute("/api/auth/google", {
      token: input.token,
      role: input.role,
    });
    if (!res.ok) throw new Error("Social Login failed");
    return;
  }

  const { email, password } = input as EmailLogin;
  const res = await postAuthRoute("/api/auth/login", { email, password });
  if (!res.ok) throw new Error("Invalid email or password");
}

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: loginRequest,
    onSuccess: async () => {
      // Re-resolve identity under the fresh token before landing, so
      // the dashboard never renders a stale logged-out snapshot.
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      // "/" is the PUBLIC discovery hub (no session concept) — landing
      // there post-login would strand an authenticated landlord away
      // from their listings. "/dashboard" resolves the session's user
      // id and forwards to their dashboard home.
      router.push("/dashboard");
    },
  });
}

export type RegisterInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword?: string;
  role?: string;
};

async function registerRequest(input: RegisterInput | GoogleAuth): Promise<void> {
  if ("providerName" in input && input.providerName === "google") {
    const res = await postAuthRoute("/api/auth/google", {
      token: input.token,
      role: input.role,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Google Sign Up Failed");
    }
    return;
  }

  const { firstName, lastName, email, password, role } = input as RegisterInput;
  const res = await fetch(`${API_URL}/accounts/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      role,
      first_name: firstName,
      last_name: lastName,
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const firstFieldWithError = Object.keys(errorData)[0];
    throw new Error(
      errorData[firstFieldWithError]?.[0] ?? "Registration failed",
    );
  }
}

export function useRegister() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerRequest,
    onSuccess: async (_data, input) => {
      const isGoogle =
        "providerName" in input && input.providerName === "google";
      if (isGoogle) {
        // Google register authenticates immediately (session cookies set) —
        // same landing as login.
        await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        router.push("/dashboard");
        return;
      }
      toast.success("Account created", {
        description: "Check your email to verify your account",
      });
      router.push("/login");
    },
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Only the server can delete httpOnly cookies, so signing out is a
      // request to app/api/auth/logout/route.ts. That route clears both
      // cookies and revokes the refresh token at Django. It answers
      // straight away (the Django call runs after the response), so this
      // never waits on the backend waking up.
      //
      // Awaited before redirecting: /login sends anyone who still has a
      // session cookie on to /dashboard, so the cookies must be gone
      // first.
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error(`Logout failed (HTTP ${res.status})`);
    },
    onSuccess: async () => {
      // Drop cached identity/data so the next session can't flash the
      // previous user's dashboard.
      queryClient.clear();
      router.push("/login");
    },
    onError: () => {
      toast.error("Couldn't sign you out", {
        description: "Check your connection and try again.",
      });
    },
  });
}
