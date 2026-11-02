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
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Text } from "@quieter/ui/text";
import { WorkspaceHeader } from "@quieter/ui/workspace-section";
import { useBlocker } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useRef } from "react";

import { useBroadcastWorkspace } from "./broadcast-workspace";

export const BroadcastHeader = ({
  action,
  back,
  children,
  controls,
  description,
  title,
}: {
  action?: ReactNode;
  back?: "audiences" | "campaigns" | "templates";
  children?: ReactNode;
  controls?: ReactNode;
  description?: ReactNode;
  title: string;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  return (
    <WorkspaceHeader>
      <div className="@container flex flex-col gap-3">
        <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @lg:flex-1">
            <div className="flex max-w-full min-w-0 items-center gap-3">
              {back ? (
                <IconButtonTooltip
                  label={`Back to ${back === "audiences" ? "all audiences" : back}`}
                >
                  <LinkButton
                    aria-label={`Back to ${back === "audiences" ? "all audiences" : back}`}
                    search={{ organizationId }}
                    size="icon"
                    to={`/${back}`}
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
                  </LinkButton>
                </IconButtonTooltip>
              ) : null}
              <Text as="h1" size="lg" truncate weight="medium">
                {title}
              </Text>
            </div>
            {children}
          </div>
          {action}
        </div>
        {description !== undefined && description !== null ? (
          <div className="text-body-sm/5 text-muted-fg">{description}</div>
        ) : null}
        {controls}
      </div>
    </WorkspaceHeader>
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
    <Button onClick={onRetry} size="default" variant="secondary">
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
          <Button
            onClick={() => blocker.reset?.()}
            size="default"
            variant="secondary"
          >
            Keep editing
          </Button>
          <Button
            onClick={() => blocker.proceed?.()}
            size="default"
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
