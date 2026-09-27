import type { Metadata } from "next";
import React, { Suspense } from "react";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { ConsentProvider } from "@/providers/consent-provider";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { fontVariables } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "paddy — verified rentals in Ghana",
  description:
    "Staff-verified long-term rentals in Accra and Kumasi. No fraud, no misleading photos, no 2-year advance demands.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Suspense>
          <GoogleOAuthProvider
            clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}
          >
            <ConsentProvider>
              <QueryProvider>{children}</QueryProvider>
              <CookieConsentBanner />
            </ConsentProvider>
          </GoogleOAuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
