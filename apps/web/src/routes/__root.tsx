/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Providers } from "~/components/providers";
import { toMailboxSearch } from "~/lib/search-params";
import appCss from "~/styles.css?url";

const faviconHref =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230f172a'/%3E%3Ctext x='32' y='41' text-anchor='middle' font-size='30' fill='white'%3Eq%3C/text%3E%3C/svg%3E";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  head: () => ({
    links: [
      {
        href: faviconHref,
        rel: "icon",
        type: "image/svg+xml",
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
        <Scripts />
      </body>
    </html>
  );
}

function RootErrorComponent({ error, reset }: { error: Error | null; reset: () => void }) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "An unexpected error occurred while loading this screen.";

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground-dark">
          Something broke.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/60"
            onClick={() => reset()}
            type="button"
          >
            Retry
          </button>

          <Link
            className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/60"
            search={toMailboxSearch({})}
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
      <div className="w-full max-w-xl rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The route you requested does not exist.
        </p>
        <Link
          className="mt-6 inline-flex rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/60"
          search={toMailboxSearch({})}
          to="/"
        >
          Go to inbox
        </Link>
      </div>
    </div>
  );
}
