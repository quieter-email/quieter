"use client";

import type { FullOrganization } from "@quieter/app/features/settings/components/organization-settings/domain";
import {
  getMailTrackingSettingsQueryKey,
  mailDeliveryMetricsQueryOptions,
  mailTrackingSettingsQueryOptions,
} from "@quieter/app/features/settings/components/organization-settings/mail-delivery";
import type { MailDeliveryMetricsRange } from "@quieter/app/features/settings/components/organization-settings/mail-delivery";
import { MailDeliveryMetrics } from "@quieter/app/features/settings/components/organization-settings/mail-delivery-metrics";
import {
  SettingsCard,
  SettingsLoadingState,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { cn } from "@quieter/ui/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectScrollDownArrow,
  SelectScrollUpArrow,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

export const MailDeliveryView = ({
  canManage,
  organization,
}: {
  canManage: boolean;
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<MailDeliveryMetricsRange>("7d");
  const [mailboxId, setMailboxId] = useState<string>("");

  const { data: mailboxes } = useQuery({
    ...mailboxesQueryOptions(),
    enabled: canManage,
  });
  const managedMailboxes = (mailboxes?.groups ?? [])
    .flatMap((group) => group.mailboxes)
    .filter(
      (mailbox) =>
        mailbox.provider === "managed" &&
        mailbox.organizationId === organization.id
    );

  const {
    data: trackingSettings,
    isPending: isTrackingPending,
    isError: isTrackingError,
    error: trackingError,
  } = useQuery({
    ...mailTrackingSettingsQueryOptions(organization.id),
    enabled: canManage,
  });

  const {
    data: metrics,
    isPending: isMetricsPending,
    isError: isMetricsError,
  } = useQuery({
    ...mailDeliveryMetricsQueryOptions(organization.id, range, mailboxId),
    enabled: canManage,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: getMailTrackingSettingsQueryKey(organization.id),
    });
  };

  const saveMutation = useMutation(
    orpc.organization.setMailTrackingSettings.mutationOptions({
      onError: (error) => {
        toastError(error);
      },
      onSuccess: async () => {
        await invalidate();
      },
    })
  );

  let content: ReactNode;
  if (!canManage) {
    content = (
      <SettingsCard>
        <p
          className={cn(
            settingsSurfaceVariants({ variant: "value" }),
            settingsSurfaceVariants({ variant: "padding" })
          )}
        >
          Only admins and owners can manage delivery settings and metrics.
        </p>
      </SettingsCard>
    );
  } else if (
    isTrackingPending ||
    isTrackingError ||
    trackingSettings === undefined
  ) {
    content = isTrackingError ? (
      <SettingsCard>
        <p
          className={cn(
            settingsSurfaceVariants({ variant: "value" }),
            "text-destructive",
            settingsSurfaceVariants({ variant: "padding" })
          )}
        >
          {trackingError?.message ?? "Could not load delivery settings."}
        </p>
      </SettingsCard>
    ) : (
      <SettingsLoadingState label="Loading delivery settings" />
    );
  } else {
    content = (
      <SettingsCard>
        <SettingsRow
          action={
            <Switch
              aria-label="Open tracking"
              checked={trackingSettings.openTrackingEnabled}
              disabled={saveMutation.isPending}
              id="mail-open-tracking-toggle"
              onCheckedChange={(checked) => {
                saveMutation.mutate({
                  openTrackingEnabled: checked,
                  organizationId: organization.id,
                });
              }}
            >
              <SwitchThumb />
            </Switch>
          }
          title="Open tracking"
        >
          Estimate opens using a small tracking image. Ad blockers and email
          clients can distort open counts. An open does not confirm a message
          was read.
        </SettingsRow>
        <SettingsRow
          action={
            <Switch
              aria-label="Allow API senders to turn off tracking per message"
              checked={trackingSettings.allowPerSendOverride}
              disabled={
                saveMutation.isPending || !trackingSettings.openTrackingEnabled
              }
              id="mail-tracking-override-toggle"
              onCheckedChange={(checked) => {
                saveMutation.mutate({
                  allowPerSendOverride: checked,
                  organizationId: organization.id,
                });
              }}
            >
              <SwitchThumb />
            </Switch>
          }
          title="Per-message control"
        >
          Let API senders turn tracking off for individual messages.
        </SettingsRow>
      </SettingsCard>
    );
  }

  let metricsSection: ReactNode;
  if (!canManage) {
    metricsSection = null;
  } else if (isMetricsError) {
    metricsSection = (
      <div className={settingsSurfaceVariants({ variant: "padding" })}>
        <Text role="alert" tone="destructive">
          Could not load delivery metrics.
        </Text>
      </div>
    );
  } else if (isMetricsPending || metrics === undefined) {
    metricsSection = <SettingsLoadingState label="Loading metrics" />;
  } else {
    metricsSection = (
      <MailDeliveryMetrics metrics={metrics} range={range} to={metrics.to} />
    );
  }

  const mailboxOptions = [
    { label: "All team mail", value: "" },
    ...managedMailboxes.map((mailbox) => ({
      label: mailbox.displayName ?? mailbox.emailAddress ?? mailbox.id,
      value: mailbox.id,
    })),
  ];
  const rangeOptions = [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
  ];

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader title="Delivery">
        Delivery and engagement for your team mail.
      </SettingsPageHeader>

      {canManage ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-body text-fg">Overview</h2>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {managedMailboxes.length > 0 ? (
                <Select
                  items={mailboxOptions}
                  onValueChange={(value) => {
                    if (value !== null) {
                      setMailboxId(value);
                    }
                  }}
                  value={mailboxId}
                >
                  <SelectTrigger
                    aria-label="Mailbox"
                    className="w-auto max-w-44"
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectScrollUpArrow />
                    <SelectList>
                      {mailboxOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectList>
                    <SelectScrollDownArrow />
                  </SelectContent>
                </Select>
              ) : null}
              <Select
                items={rangeOptions}
                onValueChange={(value) => {
                  if (value === "7d" || value === "30d") {
                    setRange(value);
                  }
                }}
                value={range}
              >
                <SelectTrigger
                  aria-label="Time range"
                  className="w-auto"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    {rangeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            </div>
          </div>
          {metricsSection}
        </section>
      ) : null}

      <SettingsSection title="Tracking">{content}</SettingsSection>
    </div>
  );
};
