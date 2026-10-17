"use client";

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

import { toastError } from "#/lib/error-toast";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import {
  SettingsCard,
  SettingsLoadingState,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "../settings-layout";
import type { FullOrganization } from "./domain";
import {
  getMailTrackingSettingsQueryKey,
  mailDeliveryMetricsQueryOptions,
  mailTrackingSettingsQueryOptions,
} from "./mail-delivery";
import type { MailDeliveryMetricsRange } from "./mail-delivery";

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
          Adds a small invisible marker to html messages this team sends. Opens
          are approximate: privacy proxies, caching, image blocking, and
          automatic tools can fake or miss opens, so an open never proves a
          person read a message.
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
          title="Allow API senders to choose per message"
        >
          Lets authorized API senders turn tracking off for a single send.
          Without this, the team setting applies to every message.
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
    const eventCounts = metrics.eventsByType ?? {};
    const sent = eventCounts.sent ?? 0;
    const delivered = eventCounts.delivered ?? 0;
    const bounced = eventCounts.bounced ?? 0;
    const complained = eventCounts.complained ?? 0;
    const unsubscribed = eventCounts.unsubscribed ?? 0;
    metricsSection = (
      <>
        {[
          {
            hint: "Message-recipient pairs accepted for sending in this period",
            label: "Sent",
            value: sent,
          },
          {
            hint: "Recipients whose mail server accepted the message in this period",
            label: "Delivered",
            value: delivered,
          },
          {
            hint: "Recipients with permanent delivery failures in this period",
            label: "Bounced",
            value: bounced,
          },
          {
            hint: "Recipients who reported spam",
            label: "Complained",
            value: complained,
          },
          { label: "Unsubscribed", value: unsubscribed },
          {
            hint: "Approximate. Privacy proxies, caches, and bots distort opens.",
            label: "Opened messages",
            value: metrics.openedMessages,
          },
        ].map((metric) => (
          <SettingsRow
            action={
              <span
                className={cn(
                  settingsSurfaceVariants({ variant: "title" }),
                  "tabular-nums"
                )}
              >
                {metric.value.toLocaleString()}
              </span>
            }
            key={metric.label}
            title={metric.label}
          >
            {metric.hint}
          </SettingsRow>
        ))}
      </>
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
    { label: "7 days", value: "7d" },
    { label: "30 days", value: "30d" },
  ];

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader title="Delivery">
        Understand what happened to messages this team sent. Counts show
        distinct message-recipient pairs for each event type observed in the
        selected period; open numbers are best-effort estimates and never prove
        a person read anything.
      </SettingsPageHeader>

      <SettingsSection title="Tracking">{content}</SettingsSection>

      <SettingsSection title="Recent activity">
        <SettingsCard>
          <SettingsRow
            action={
              <Select
                items={rangeOptions}
                onValueChange={(value) => {
                  if (value === "7d" || value === "30d") {
                    setRange(value);
                  }
                }}
                value={range}
              >
                <SelectTrigger aria-label="Time range" size="sm">
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
            }
            title="Time range"
          />
          {managedMailboxes.length > 0 && (
            <SettingsRow
              action={
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
                    className="max-w-48"
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
              }
              title="Mailbox"
            />
          )}
          {metricsSection}
        </SettingsCard>
        <p className={settingsSurfaceVariants({ variant: "value" })}>
          Delivery events describe what receiving mail servers confirmed.
          Complaints and unsubscribes block future sends automatically.
        </p>
      </SettingsSection>
    </div>
  );
};
