import { cookies } from "next/headers";

// Server-side session check for server components and layouts (login,
// register, onboarding, reset-password pages + the (admin) layout
// gate). Reads the access_token COOKIE — localStorage doesn't exist on
// the server. Presence-only: validity is re-checked per-request by the
// API calls themselves (and by (admin)/layout.tsx's /accounts/me/
// call for the dashboard area).
export const authServer = {
  check: async (): Promise<{
    authenticated: boolean;
    redirectTo?: string;
  }> => {
    const cookieStore = await cookies();
    const auth = cookieStore.get("access_token");

    if (auth) {
      return {
        authenticated: true as const,
      };
    }

    return {
      authenticated: false as const,
      redirectTo: "/login",
    };
  },
};
