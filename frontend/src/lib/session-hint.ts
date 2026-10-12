// The one session cookie browser code is allowed to read.
//
// The real session (the two JWTs) lives in httpOnly cookies that browser
// JavaScript can't see at all (lib/auth-cookies.ts). That's the point, but
// it means client code can't tell "signed in" from "signed out" without
// asking the server. Asking on every page load would send every logged-out
// visitor's browser to /accounts/me/ just to get a 401 back.
//
// So the server also sets `signed_in=1` next to the refresh token, with the
// same lifetime, and clears it whenever it clears the session. It holds no
// secret: reading it tells a script nothing it could use, and faking it only
// makes the browser ask /accounts/me/, which answers 401 as before.
//
// Shared by lib/auth-cookies.ts (server) and hooks/use-auth.ts (browser).
// src/proxy.ts keeps its own copy of the name (it imports nothing from src/).

export const SIGNED_IN_COOKIE = "signed_in";

export function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((cookie) => cookie.startsWith(`${SIGNED_IN_COOKIE}=`));
}
