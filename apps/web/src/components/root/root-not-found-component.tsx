"use client";

import { Button, LinkButton } from "@quieter/ui/button";
import { useCanGoBack, useLocation, useRouter } from "@tanstack/react-router";

import { StatusScreen } from "#/components/root/status-screen";

const MAX_SHOWN_PATH_LENGTH = 64;

export const RootNotFoundComponent = () => {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const pathname = useLocation({ select: (location) => location.pathname });

  const shownPath =
    pathname.length > MAX_SHOWN_PATH_LENGTH
      ? `${pathname.slice(0, MAX_SHOWN_PATH_LENGTH)}…`
      : pathname;

  return (
    <StatusScreen
      actions={
        <>
          <LinkButton to="/">Back to inbox</LinkButton>
          {canGoBack ? (
            <Button
              className="border-fg/20 bg-transparent text-fg hover:bg-fg/10"
              onClick={() => {
                router.history.back();
              }}
              variant="outline"
            >
              Go back
            </Button>
          ) : null}
        </>
      }
      description="There is no page at this address. The link may be old, or it may have moved somewhere quieter."
      ghost="404"
      note={shownPath}
      title="It’s pretty quiet here."
    />
  );
};
