"use client";

import { Settings01Icon } from "@hugeicons/core-free-icons";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { appRuntime } from "@quieter/app/runtime";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { reminderPreferencesOptions } from "./reminder-query";

export const ReminderOptions = ({ mailboxId }: { mailboxId: string }) => {
  const queryClient = useQueryClient();
  const preferences = useQuery(reminderPreferencesOptions(mailboxId));
  const notifications = useQuery({
    enabled: appRuntime.reminderNotifications !== undefined,
    queryFn: async () =>
      (await appRuntime.reminderNotifications?.getStatus()) ?? "unsupported",
    queryKey: ["reminder-notifications"],
  });
  const notificationChange = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await appRuntime.reminderNotifications?.setEnabled(enabled)) ??
      "unsupported",
    onError: (error) => {
      toastError(error, {
        boundary: "reminder-notifications",
        fallback: "Could not change notifications. Please try again.",
      });
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["reminder-notifications"], status);
    },
  });
  const change = useMutation({
    mutationFn: async (
      patch: { automatic: boolean } | { suggestions: boolean }
    ) => {
      const current = preferences.data;
      if (!current) {
        throw new Error("Load reminder preferences before changing them.");
      }
      return await rpc.reminders.updatePreferences({
        mailboxId,
        ...current,
        ...patch,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    onError: (error) => {
      toastError(error, {
        boundary: "reminder-preferences",
        fallback: "Could not change reminder preferences. Please try again.",
      });
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(
        reminderPreferencesOptions(mailboxId).queryKey,
        next
      );
      await queryClient.invalidateQueries({
        queryKey: ["reminder-suggestion", mailboxId],
      });
    },
  });
  return (
    <Popover>
      <IconButtonTooltip label="Reminder options">
        <PopoverTrigger
          render={
            <Button
              aria-label="Reminder options"
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <Icon icon={Settings01Icon} />
        </PopoverTrigger>
      </IconButtonTooltip>
      <PopoverContent align="end" size="sm">
        <div className="space-y-4">
          <h3 className="text-body-sm font-medium">Reminder options</h3>
          {preferences.isError ? (
            <>
              <p className="text-body-sm">Could not load preferences.</p>
              <Button
                onClick={() => {
                  void preferences.refetch();
                }}
                variant="secondary"
              >
                Try again
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-body-sm">Suggest reminders</p>
                  <p className="text-caption text-muted-fg">
                    Occasional suggestions for clear requests and meaningful
                    dates in mail you open. Dismiss any you do not want.
                  </p>
                </div>
                <Switch
                  aria-label="Suggest reminders"
                  checked={preferences.data?.suggestions ?? false}
                  pending={change.isPending}
                  disabled={preferences.isPending}
                  onCheckedChange={(suggestions) => {
                    change.mutate({ suggestions });
                  }}
                  size="sm"
                >
                  <SwitchThumb />
                </Switch>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-body-sm">Automatic reminders</p>
                  <p className="text-caption text-muted-fg">
                    Off by default. Create reminders only for clear requests
                    with a specific date. Review or cancel them here.
                  </p>
                </div>
                <Switch
                  aria-label="Automatic reminders"
                  checked={preferences.data?.automatic ?? false}
                  pending={change.isPending}
                  disabled={preferences.isPending}
                  onCheckedChange={(automatic) => {
                    change.mutate({ automatic });
                  }}
                  size="sm"
                >
                  <SwitchThumb />
                </Switch>
              </div>
              <p className="text-caption text-muted-fg">
                Date suggestions and reply checks use AI credits from your plan.
                They can make mistakes.
              </p>
            </>
          )}
          {appRuntime.reminderNotifications &&
          notifications.data !== "unsupported" ? (
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-body-sm">Desktop notifications</p>
                <p className="text-caption text-muted-fg">
                  {notifications.data === "blocked"
                    ? "Notifications are blocked in system settings."
                    : "Show a private alert when a reminder is due."}
                </p>
              </div>
              <Switch
                aria-label="Desktop reminder notifications"
                checked={notifications.data === "enabled"}
                disabled={
                  notifications.isPending || notificationChange.isPending
                }
                onCheckedChange={(enabled) => {
                  notificationChange.mutate(enabled);
                }}
                size="sm"
              >
                <SwitchThumb />
              </Switch>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
