"use client";

import { Button, LinkButton } from "@quieter/ui/button";
import * as Sentry from "@sentry/tanstackstart-react";
import { useEffect } from "react";

import { StatusScreen } from "#/components/root/status-screen";

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

  const developerMessage =
    import.meta.env.DEV && error instanceof Error && error.message
      ? error.message
      : undefined;

  return (
    <StatusScreen
      actions={
        <>
          <Button
            onClick={() => {
              reset();
            }}
          >
            Try again
          </Button>
          <LinkButton
            className="border-fg/20 bg-transparent text-fg hover:bg-fg/10"
            to="/"
            variant="outline"
          >
            Back to inbox
          </LinkButton>
        </>
      }
      ghost="5XX"
      danger
      description="An error occurred while loading this page. Please try again. If the problem persists, please contact support."
      note={developerMessage}
      title="Something broke on our end."
    />
  );
};
