"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground-dark">
          Something broke.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred while loading this screen."}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {reset ? (
            <button
              className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/60"
              onClick={() => reset()}
              type="button"
            >
              Retry
            </button>
          ) : null}

          <Link
            className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/60"
            href="/"
          >
            Back to inbox
          </Link>
        </div>
      </div>
    </div>
  );
}
