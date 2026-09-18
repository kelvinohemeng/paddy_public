"use client";

import React from "react";
import { Refine, GitHubBanner } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import routerProvider from "@refinedev/nextjs-router";

import { dataProvider } from "@providers/data-provider";
import { ErrorComponent } from "@/components/refine-ui/layout/error-component";
import { Layout } from "@/components/refine-ui/layout/layout";
import { Header } from "@/components/refine-ui/layout/header";
import { useNotificationProvider } from "@/components/refine-ui/notification/use-notification-provider";
import { Toaster } from "@/components/refine-ui/notification/toaster";
import { ThemeProvider } from "@/components/refine-ui/theme/theme-provider";
import "@/app/globals.css";
import { authProviderClient } from "@providers/auth-provider/auth-provider.client";

type RefineContextProps = {
  children: React.ReactNode;
};

export const RefineContext = ({ children }: RefineContextProps) => {
  const notificationProvider = useNotificationProvider();

  return (
    <RefineKbarProvider>
      <ThemeProvider>
        <Refine
          dataProvider={dataProvider}
          notificationProvider={notificationProvider}
          authProvider={authProviderClient}
          routerProvider={routerProvider}
          resources={[
            {
              name: "blog_posts",
              list: "/blog-posts",
              create: "/blog-posts/create",
              edit: "/blog-posts/edit/:id",
              show: "/blog-posts/show/:id",
              meta: {
                canDelete: true,
              },
            },
            {
              name: "categories",
              list: "/categories",
              create: "/categories/create",
              edit: "/categories/edit/:id",
              show: "/categories/show/:id",
              meta: {
                canDelete: true,
              },
            },
            {
              name: "dashboard",
              list: "/dashboard",
              meta: {
                label: "My Listings",
              },
              // Purely a NAVIGATION resource — gives the sidebar a
              // stable, always-resolvable link (Refine's menu can't
              // auto-fill a raw ":user" route param the way it fills
              // ":id" for a specific record, so a generic "listings"
              // menu link would render literally as
              // "/dashboard/:user/listings", which 404s). "/dashboard"
              // itself is a server-redirect (see dashboard/page.tsx)
              // that resolves the CURRENT session's user id and sends
              // the browser on to the real
              // /dashboard/[user]/listings destination.
            },
            {
              name: "listings",
              list: "/dashboard/:user/listings",
              create: "/dashboard/:user/listings/create",
              edit: "/dashboard/:user/listings/:id/edit",
              show: "/dashboard/:user/listings/:id",
              meta: {
                // Hidden from the auto-generated sidebar for the same
                // ":user"-can't-auto-resolve reason as above — the
                // "dashboard" resource above is what actually appears
                // in the sidebar; this entry exists so useForm/
                // useList/useOne/etc. (which key off resource NAME,
                // not these route strings) keep working, and so
                // redirect()/composeRoute() calls elsewhere produce
                // the correct URL shape when they do need it.
                hide: true,
              },
            },
            {
              name: "core/amenities",
              // Matches the real backend URL exactly (/core/amenities/)
              // — the generic dataProvider builds URLs as
              // `${API_URL}/${resource}/`, so the resource name itself
              // carries the "core/" prefix rather than needing any
              // special-case logic inside the data provider. No list/
              // create/edit/show routes registered — this resource has
              // no dedicated PAGES, it's used purely as a data source
              // (via useSelect/useList) from within the listing form.
            },
          ]}
          options={{
            syncWithLocation: true,
            warnWhenUnsavedChanges: true,
          }}
        >
          {children}
          <Toaster />
          <RefineKbar />
        </Refine>
      </ThemeProvider>
    </RefineKbarProvider>
  );
};
