"use client";

import { Button, LinkButton } from "@quieter/ui/button";
import * as Sentry from "@sentry/react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";

import { StatusScreen } from "#/components/root/status-screen";

export const RootErrorComponent = ({ error, reset }: ErrorComponentProps) => {
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (!import.meta.env.DEV && error !== null) {
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
          <LinkButton to="/" variant="overlay">
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
