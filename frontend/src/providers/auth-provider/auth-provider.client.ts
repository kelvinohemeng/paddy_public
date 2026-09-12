"use client";

import type { AuthProvider } from "@refinedev/core";
import Cookies from "js-cookie";


export const authProviderClient: AuthProvider = {
  register: async ({ email, username, password, role }) => {

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/accounts/register/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        username,
        password,
        role,
      }),
    });

    if (res.ok) {
      // Your backend returns 201 + {id, email, role} — deliberately NO
      // access/refresh tokens, since RegisterSerializer never logs the
      // user in, it just creates the account and fires a verification
      // email (send_verification_email in views.py). That means we
      // canNOT redirect straight to "/" like a logged-in dashboard —
      // there's no token yet to prove who they are.
      return {
        success: true,
        redirectTo: "/login",
        successNotification: {
          message: "Account created",
          description: "Check your email to verify your account"
        }
      }

      // Your backend's real failure shape, confirmed from views.py:
      // - email already registered -> {"email": ["user with this email already exists"]}
      // - role is "admin"/"staff" -> {"role": ["You cannot register with this role."]}
      // - DRF validation errors are always {field_name: [messages]}, so we
      //   pull out whichever field actually has an error and surface its
      //   first message, rather than a generic "Registration failed"

    }
    const errorData = await res.json();
    const firstFieldWithError = Object.keys(errorData)[0];
    const firstMessage = errorData[firstFieldWithError]?.[0] ?? "Registration failed";

    return {
      success: false,
      error: {
        name: "RegisterError",
        message: firstMessage,
      },
    };
  },

  login: async ({ email, password }) => {

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/accounts/login/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (res.ok) {
      const data = await res.json();

      Cookies.set("access_token", data.access, { expires: 1, path: "/" });

      // localStorage — decided earlier: simple to start with, browser-only
      // (this is exactly why login/register/everything auth-related has
      // to be a Client Component — no localStorage on the server)
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);

      return {
        success: true,
        redirectTo: "/",
      };
    }

    return {
      success: false,
      error: {
        name: "LoginError",
        message: "Invalid email or password",
      },
    }
  },

  logout: async () => {
    // Unlike login, this doesn't NEED to call the backend to "work" —
    // JWTs aren't tracked server-side the way a session cookie is, so
    // just deleting the tokens from this browser is enough to make this
    // browser "logged out": every future request will have no token to
    // attach, and check() (coming up next) will correctly report
    // authenticated: false.
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    Cookies.remove("access_token");

    return {
      success: true,
      redirectTo: "/login",
    };
  },

  check: async () => {
    const token = localStorage.getItem("access_token");
    if (token) {
      return {
        authenticated: true,
      };
    }

    return {
      authenticated: false,
      logout: true,
      redirectTo: "/login",
    };
  },

  getIdentity: async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {

      return null;
    }

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/accounts/me/`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }
    return await res.json();
  },
  onError: async (error) => {
    if (error.response?.status === 401) {
      return {
        logout: true,
      };
    }

    return { error };
  },
};
