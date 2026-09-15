"use client";

import type { AuthProvider } from "@refinedev/core";
import Cookies from "js-cookie";



// A reusable helper function to process a successful login/OAuth response 
// and store tokens across cookies and localStorage.
const handleAuthSuccess = async (response: Response) => {
  const data = await response.json();

  // Set cookie for middleware/SSR safety, and localStorage for client-side persistence
  Cookies.set("access_token", data.access, { expires: 1, path: "/" });
  localStorage.setItem("access_token", data.access);
  localStorage.setItem("refresh_token", data.refresh);

  return {
    success: true,
    redirectTo: "/",
  };
};

export const authProviderClient: AuthProvider = {
  register: async (params) => {
    if (params.providerName === "google") {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/accounts/login/google/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: params.token,
          role: params.role,
        }),
      })

      if (res.ok) {
        return await handleAuthSuccess(res);
      }

      const errorData = await res.json()
      return {
        success: false,
        error: { name: "RegisterError", message: errorData.error || "Google Sign Up Failed" }
      }

    }

    const { email, username, password, role } = params;

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
      return {
        success: true,
        redirectTo: "/login",
        successNotification: {
          message: "Account created",
          description: "Check your email to verify your account"
        }
      }

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

  login: async (params) => {
    //handle Google Login
    if (params.providerName === "google") {
      // Google-specific path: params.credential is the ID token
      // handed to us by @react-oauth/google's callback
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/accounts/login/google/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: params.token,
            role: params.role
          }),
        }
      )

      if (res.ok) {
        return await handleAuthSuccess(res)
      }

      return {
        success: false,
        error: {
          name: "LoginError",
          message: "Social Login failed",
        },
      }
    }

    const { email, password, ...allParams } = params;

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
    const user = await res.json()
    return user;
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
