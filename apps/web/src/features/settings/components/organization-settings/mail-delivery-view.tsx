"use client";

import { cn } from "@quieter/ui/cn";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { mailboxesQueryOptions } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import {
  SettingsBackButton,
  SettingsCard,
  SettingsLoadingState,
  settingsSurfaceVariants,
} from "../settings-layout";
import type { FullOrganization } from "./domain";
import {
  getMailTrackingSettingsQueryKey,
  mailDeliveryMetricsQueryOptions,
  mailTrackingSettingsQueryOptions,
} from "./mail-delivery";
import type { MailDeliveryMetricsRange } from "./mail-delivery";

const percentFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  style: "percent",
});

const formatRate = (part: number, whole: number) =>
  whole > 0 ? percentFormatter.format(part / whole) : "No data";

const MetricRow = ({
  hint,
  label,
  value,
}: {
  hint?: string;
  label: string;
  value: string;
}) => (
  <div
    className={cn(
      settingsSurfaceVariants({ variant: "insetRow" }),
      "items-center justify-between gap-3"
    )}
  >
    <div className="min-w-0">
      <p className="text-body text-fg">{label}</p>
      {hint !== undefined && (
        <p className="mt-0.5 text-caption text-muted-fg">{hint}</p>
      )}
    </div>
    <span className="shrink-0 text-body font-semibold text-fg tabular-nums">
      {value}
    </span>
  </div>
);

const ToggleButton = ({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) => (
  <button
    aria-pressed={active}
    className={cn(
      "max-w-40 truncate rounded-md px-2.5 py-1 text-caption font-medium transition-colors",
      {
        "bg-bg text-fg shadow-xs": active,
        "text-muted-fg hover:text-fg": !active,
      }
    )}
    onClick={onSelect}
    type="button"
  >
    {label}
  </button>
);

const RangeToggle = ({
  range,
  setRange,
}: {
  range: MailDeliveryMetricsRange;
  setRange: (range: MailDeliveryMetricsRange) => void;
}) => (
  <div className="flex shrink-0 gap-1 rounded-lg border border-border p-0.5">
    {(["7d", "30d"] as const).map((candidate) => (
      <ToggleButton
        active={range === candidate}
        key={candidate}
        label={candidate === "7d" ? "7 days" : "30 days"}
        onSelect={() => {
          setRange(candidate);
        }}
      />
    ))}
  </div>
);

export const MailDeliveryView = ({
  canManage,
  onBack,
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
    .filter((mailbox) => mailbox.provider === "managed");

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
      onError: () => {
        toast.error("Could not save tracking settings.");
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
            "text-body text-muted-fg",
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
            "text-body text-destructive",
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
      <div className="space-y-3">
        <div
          className={cn(
            settingsSurfaceVariants({ variant: "insetRow" }),
            "items-start justify-between gap-4"
          )}
        >
          <div className="max-w-xl">
            <p className="text-body font-medium text-fg">Open tracking</p>
            <p className="mt-1 text-body text-muted-fg">
              Adds a small invisible marker to html messages this team sends.
              Opens are approximate: privacy proxies, caching, image blocking,
              and automatic tools can fake or miss opens, so an open never
              proves a person read a message.
            </p>
          </div>
          <Switch
            checked={trackingSettings.openTrackingEnabled}
            className="mt-1 shrink-0"
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
        </div>

        <div
          className={cn(
            settingsSurfaceVariants({ variant: "insetRow" }),
            "items-start justify-between gap-4",
            { "opacity-60": !trackingSettings.openTrackingEnabled }
          )}
        >
          <div className="max-w-xl">
            <p className="text-body font-medium text-fg">
              Allow senders to choose per message
            </p>
            <p className="mt-1 text-body text-muted-fg">
              Lets authorized senders turn tracking off for a single send.
              Without this, the team setting applies to every message.
            </p>
          </div>
          <Switch
            checked={trackingSettings.allowPerSendOverride}
            className="mt-1 shrink-0"
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
        </div>
      </div>
    );
  }

  let metricsSection: ReactNode;
  if (!canManage) {
    metricsSection = null;
  } else if (isMetricsError) {
    metricsSection = (
      <p className="text-body text-destructive" role="alert">
        Could not load delivery metrics.
      </p>
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
      <div className="space-y-3">
        <MetricRow
          hint="Accepted by us for sending"
          label="Sent"
          value={sent.toLocaleString()}
        />
        <MetricRow
          hint={`${formatRate(delivered, sent)} of sent`}
          label="Delivered"
          value={delivered.toLocaleString()}
        />
        <MetricRow
          hint={`${formatRate(bounced, sent)} of sent`}
          label="Bounced"
          value={bounced.toLocaleString()}
        />
        <MetricRow
          hint="Recipients who reported spam"
          label="Complained"
          value={complained.toLocaleString()}
        />
        <MetricRow label="Unsubscribed" value={unsubscribed.toLocaleString()} />
        <MetricRow
          hint="Approximate. Privacy proxies, caches, and bots distort opens."
          label="Opened messages"
          value={metrics.openedMessages.toLocaleString()}
        />
      </div>
    );
  }

  return (
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>
        {organization.name}
      </SettingsBackButton>

      <div>
        <h1 className="text-body-lg font-semibold text-fg">Delivery</h1>
        <p className="mt-1 max-w-2xl text-body text-muted-fg">
          Understand what happened to messages this team sent. Counts come from
          confirmed delivery events; open numbers are best-effort estimates and
          never prove a person read anything.
        </p>
      </div>

      <section aria-label="Tracking settings">
        <h2 className="mb-3 text-body font-semibold text-fg">Tracking</h2>
        {content}
      </section>

      <section aria-label="Delivery metrics">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-body font-semibold text-fg">Recent activity</h2>
          <RangeToggle range={range} setRange={setRange} />
        </div>

        {managedMailboxes.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[
              { id: "", label: "All team mail" },
              ...managedMailboxes.map((mailbox) => ({
                id: mailbox.id,
                label:
                  mailbox.displayName ?? mailbox.emailAddress ?? mailbox.id,
              })),
            ].map((scope) => {
              const active =
                scope.id === "" ? mailboxId === "" : scope.id === mailboxId;
              return (
                <button
                  aria-pressed={active}
                  className={cn(
                    "max-w-48 truncate rounded-full border px-3 py-1 text-caption font-medium transition-colors",
                    {
                      "border-border text-muted-fg hover:text-fg": !active,
                      "border-q-blue/40 bg-q-blue/10 text-q-blue": active,
                    }
                  )}
                  key={scope.id || "all"}
                  onClick={() => {
                    setMailboxId(scope.id);
                  }}
                  type="button"
                >
                  {scope.label}
                </button>
              );
            })}
          </div>
        )}

        {metricsSection}

        <p className="mt-3 text-caption text-muted-fg">
          Delivery events describe what receiving mail servers confirmed.
          Complaints and unsubscribes block future sends automatically.
        </p>
      </section>
    </div>
  );
};
