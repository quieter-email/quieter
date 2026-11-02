import { Brand } from "@quieter/ui/brand";
import { Button } from "@quieter/ui/button";
import type { ErrorComponentProps } from "@tanstack/react-router";

export const DesktopErrorScreen = ({ reset }: ErrorComponentProps) => (
  <main className="grid min-h-dvh place-items-center bg-bg text-fg">
    <div className="flex max-w-sm flex-col items-center gap-5 px-8 text-center">
      <Brand className="size-12" />
      <h1 className="text-title-sm font-medium">
        We couldn’t reach your account
      </h1>
      <p className="text-body-sm text-muted-fg">
        Check your connection and try again. Your email will be here when you
        return.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  </main>
);

export const DesktopNotFoundScreen = () => (
  <main className="grid min-h-dvh place-items-center bg-bg text-fg">
    <div className="flex flex-col items-center gap-5">
      <Brand className="size-12" />
      <h1 className="text-title-sm font-medium">This page isn’t here</h1>
      <Button
        onClick={() => {
          window.location.assign("/");
        }}
      >
        Back to inbox
      </Button>
    </div>
  </main>
);
