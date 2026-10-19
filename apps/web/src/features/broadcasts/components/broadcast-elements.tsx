import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button, LinkButton } from "@quieter/ui/button";
import { useBlocker } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useRef } from "react";

import { useBroadcastWorkspace } from "./broadcast-workspace";

export const BroadcastHeader = ({
  action,
  back,
  children,
  title,
}: {
  action?: ReactNode;
  back?: "campaigns" | "templates";
  children?: ReactNode;
  title: string;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  return (
    <header className="flex flex-col gap-4">
      {back ? (
        <LinkButton
          className="self-start"
          search={{ organizationId }}
          size="sm"
          to={back === "campaigns" ? "/campaigns" : "/templates"}
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
          {back === "campaigns" ? "Campaigns" : "Templates"}
        </LinkButton>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-title-sm font-normal tracking-tight">
            {title}
          </h1>
          {children}
        </div>
        {action}
      </div>
    </header>
  );
};

export const BroadcastLoading = ({ label }: { label: string }) => (
  <p aria-live="polite" className="py-12 text-center text-body text-muted-fg">
    {label}…
  </p>
);

export const BroadcastError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex items-center justify-center gap-3 py-12">
    <p className="text-body text-muted-fg">Could not load this page.</p>
    <Button onClick={onRetry} size="sm" variant="outline">
      Try again
    </Button>
  </div>
);

export const useDraftNavigation = (dirty: boolean) => {
  const allow = useRef(false);
  const blocker = useBlocker({
    enableBeforeUnload: dirty,
    shouldBlockFn: () => dirty && !allow.current,
    withResolver: true,
  });
  const dialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          blocker.reset?.();
        }
      }}
      open={blocker.status === "blocked"}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your last saved version will be kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={() => blocker.reset?.()} size="sm" variant="outline">
            Keep editing
          </Button>
          <Button
            onClick={() => blocker.proceed?.()}
            size="sm"
            variant="destructive"
          >
            Discard changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const leave = async (action: () => Promise<void>) => {
    allow.current = true;
    try {
      await action();
    } finally {
      allow.current = false;
    }
  };
  return { dialog, leave };
};
