"use client";

import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { appRuntime } from "@quieter/app/runtime";
import type { NewMailNotificationPreferences } from "@quieter/app/runtime";
import { Button } from "@quieter/ui/button";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { SettingsRow } from "./settings-layout";

const AccountMailboxNotificationRow = ({
  mailboxId,
  native,
  userId,
}: {
  mailboxId: string;
  native: NewMailNotificationPreferences;
  userId: string;
}) => {
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const queryClient = useQueryClient();
  const queryKey = ["new-mail-notification-preferences", userId, mailboxId];
  const status = useQuery({
    queryFn: async () => await native.getStatus({ mailboxId, userId }),
    queryKey,
    retry: false,
  });
  const change = useMutation({
    mutationFn: async (enabled: boolean) =>
      await native.setEnabled({ enabled, mailboxId, userId }),
    onError: (error) => {
      if (!active.current) {
        return;
      }
      toastError(error, {
        boundary: "new-mail-preferences",
        fallback: "Could not change notifications. Please try again.",
      });
    },
    onSuccess: (next) => {
      if (active.current) {
        queryClient.setQueryData(queryKey, next);
      }
    },
  });
  const current = status.data;
  let description =
    "Allow private new-mail alerts for this mailbox on this device. System notification settings also apply.";
  if (status.isError) {
    description = "Could not load notification preferences.";
  } else if (current?.kind === "inactive") {
    description = "Your account changed. Reopen these settings to continue.";
  } else if (current?.kind === "ready" && !current.supported) {
    description = current.enabled
      ? "Desktop alerts are unavailable on this system. You can still turn this preference off."
      : "Desktop alerts are unavailable on this system.";
  } else if (current?.kind === "ready" && current.enabled) {
    description =
      "Enabled for this account on this device. Your system may still block alerts.";
  }
  return (
    <SettingsRow
      action={
        status.isError ? (
          <Button
            onClick={() => {
              void (async () => {
                try {
                  await status.refetch({ throwOnError: true });
                } catch (error) {
                  if (!active.current) {
                    return;
                  }
                  toastError(error, {
                    boundary: "new-mail-preferences",
                    fallback:
                      "Could not load notification preferences. Please try again.",
                  });
                }
              })();
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        ) : (
          <Switch
            aria-label="New-mail notifications for this mailbox"
            checked={current?.kind === "ready" && current.enabled}
            disabled={
              status.isPending ||
              current?.kind !== "ready" ||
              (!current.supported && !current.enabled)
            }
            onCheckedChange={(enabled) => {
              change.mutate(enabled);
            }}
            pending={change.isPending}
            size="sm"
          >
            <SwitchThumb />
          </Switch>
        )
      }
      title="New-mail notifications"
    >
      {description}
    </SettingsRow>
  );
};

export const MailboxNewMailNotificationRow = ({
  mailboxId,
}: {
  mailboxId: string;
}) => {
  const native = appRuntime.newMailNotificationPreferences;
  const userId = authClient.useSession().data?.user.id;
  return native && userId ? (
    <AccountMailboxNotificationRow
      key={JSON.stringify([userId, mailboxId])}
      mailboxId={mailboxId}
      native={native}
      userId={userId}
    />
  ) : null;
};
