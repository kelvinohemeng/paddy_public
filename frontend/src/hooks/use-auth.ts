"use client";

// Auth state for the app — plain TanStack Query, no framework. This
// replaces the Refine authProvider (login/register/logout/check/
// getIdentity/onError) with the same backend contracts and the same
// token handling, owned here instead of behind Refine's interface:
//
// Token storage (unchanged semantics): BOTH tokens go in BOTH stores —
// cookies (path "/", 1-day expiry) for server-side reads (proxy.ts,
// (admin)/layout.tsx) and localStorage for client-side reads
// (authedFetch, this file). Removing both on logout is what actually
// logs a browser out; path: "/" is required on remove because the
// cookies were set with path "/".
//
// Endpoints (unchanged): POST /accounts/login/, /accounts/register/,
// /accounts/login/google/, GET /accounts/me/. Field naming: the app
// speaks camelCase, Django speaks snake_case — translation happens at
// these network boundaries only.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export type Me = {
  id: number | string;
  email?: string;
  role?: string;
  profile?: any;
  [key: string]: any;
} | null;

export const ME_QUERY_KEY = ["api", "accounts/me"];

export function storeTokens(access: string, refresh: string) {
  Cookies.set("access_token", access, { expires: 1, path: "/" });
  Cookies.set("refresh_token", refresh, { expires: 1, path: "/" });
  localStorage.setItem("access_token", access);
  localStorage.setItem("refresh_token", refresh);
}

export function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  Cookies.remove("access_token", { path: "/" });
  Cookies.remove("refresh_token", { path: "/" });
}

async function fetchMe(): Promise<Me> {
  const token = localStorage.getItem("access_token");
  if (!token) return null;

  const res = await fetch(`${API_URL}/accounts/me/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as Me;
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
    const res = await fetch(`${API_URL}/accounts/login/google/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, role: input.role }),
    });
    if (!res.ok) throw new Error("Social Login failed");
    const data = await res.json();
    storeTokens(data.access, data.refresh);
    return;
  }

  const { email, password } = input as EmailLogin;
  const res = await fetch(`${API_URL}/accounts/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid email or password");
  const data = await res.json();
  storeTokens(data.access, data.refresh);
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
    const res = await fetch(`${API_URL}/accounts/login/google/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, role: input.role }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Google Sign Up Failed");
    }
    const data = await res.json();
    storeTokens(data.access, data.refresh);
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
        // Google register authenticates immediately (tokens stored) —
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
      // JWTs aren't tracked server-side — deleting both stores is the
      // entire logout. No backend call needed.
      clearTokens();
    },
    onSuccess: async () => {
      // Drop cached identity/data so the next session can't flash the
      // previous user's dashboard.
      queryClient.clear();
      router.push("/login");
    },
  });
}
