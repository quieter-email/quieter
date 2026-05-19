/// <reference types="vite/client" />

import * as Sentry from "@sentry/tanstackstart-react";
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Providers } from "~/components/providers";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  head: () => ({
    links: [
      {
        href: "https://fonts.googleapis.com",
        rel: "preconnect",
      },
      {
        crossOrigin: "anonymous",
        href: "https://fonts.gstatic.com",
        rel: "preconnect",
      },
      {
        href: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&display=swap",
        rel: "stylesheet",
      },
      {
        href: "/favicon.ico",
        rel: "icon",
        sizes: "48x48",
      },
      {
        href: "/icon.svg",
        rel: "icon",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        href: "/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
      },
      {
        href: "/site.webmanifest",
        rel: "manifest",
      },
      {
        color: "#1a1a1a",
        href: "/safari-pinned-tab.svg",
        rel: "mask-icon",
      },
      {
        href: appCss,
        rel: "stylesheet",
      },
    ],
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "quieter",
      },
      {
        content: "light dark",
        name: "color-scheme",
      },
      {
        content: "#f7f4ee",
        media: "(prefers-color-scheme: light)",
        name: "theme-color",
      },
      {
        content: "#141414",
        media: "(prefers-color-scheme: dark)",
        name: "theme-color",
      },
      {
        content: "quieter",
        property: "og:title",
      },
      {
        content: "Email, without the noise.",
        property: "og:description",
      },
      {
        content: "/og-image.png",
        property: "og:image",
      },
      {
        content: "summary_large_image",
        name: "twitter:card",
      },
      {
        content: "/og-image.png",
        name: "twitter:image",
      },
    ],
  }),
  notFoundComponent: RootNotFoundComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Providers>
        <Outlet />
      </Providers>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <LogoDevFooter />
        <Scripts />
      </body>
    </html>
  );
}

function RootErrorComponent({ error, reset }: { error: Error | null; reset: () => void }) {
  useEffect(() => {
    if (error) {
      Sentry.captureException(error);
    }
  }, [error]);

  const message =
    error instanceof Error && error.message
      ? error.message
      : "An unexpected error occurred while loading this screen.";

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground-dark">
          Something broke.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm hover:border-foreground/25 hover:bg-muted/60"
            onClick={() => reset()}
            type="button"
          >
            Retry
          </button>

          <Link
            className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm hover:border-foreground/25 hover:bg-muted/60"
            to="/"
          >
            Back to inbox
          </Link>
        </div>
      </div>
    </div>
  );
}

function RootNotFoundComponent() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The route you requested does not exist.
        </p>
        <Link
          className="mt-6 inline-flex rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm hover:border-foreground/25 hover:bg-muted/60"
          to="/"
        >
          Go to inbox
        </Link>
      </div>
    </div>
  );
}

const LogoDevFooter = () => {
  return (
    <footer className="absolute right-2 bottom-2 z-20 px-3 py-1.5 text-[10px] text-muted-foreground">
      <a
        className="hover:text-foreground"
        href="https://logo.dev"
        target="_blank"
        title="Logos provided by logo.dev"
      >
        Logos provided by logo.dev
      </a>
    </footer>
  );
};
