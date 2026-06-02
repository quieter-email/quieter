import * as Sentry from "@sentry/tanstackstart-react";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

export const RootErrorComponent = ({
  error,
  reset,
}: {
  error: Error | null;
  reset: () => void;
}) => {
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (!import.meta.env.DEV && error) {
      Sentry.captureException(error);
    }
  }, [error]);

  const message =
    import.meta.env.DEV && error instanceof Error && error.message
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
};
