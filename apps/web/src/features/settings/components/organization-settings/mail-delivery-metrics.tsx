"use client";

import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BarChart } from "@quieter/ui/bar-chart";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Separator } from "@quieter/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";

import type { rpc } from "#/lib/orpc";

import { SettingsCard } from "../settings-layout";
import type { MailDeliveryMetricsRange } from "./mail-delivery";

const deliverySeries = [
  { color: "var(--chart-3)", key: "sent", label: "Sent" },
  { color: "var(--success)", key: "delivered", label: "Delivered" },
  { color: "var(--warning)", key: "bounced", label: "Bounced" },
];

export const MailDeliveryMetrics = ({
  metrics,
  openTrackingEnabled,
  range,
  to,
}: {
  metrics: Awaited<ReturnType<typeof rpc.organization.getMailDeliveryMetrics>>;
  openTrackingEnabled: boolean | undefined;
  range: MailDeliveryMetricsRange;
  to: Date;
}) => {
  const days = range === "7d" ? 7 : 30;
  const today = new Date(to);
  today.setUTCHours(0, 0, 0, 0);
  const dailyEvents = new Map(
    metrics.dailyEvents.map((day) => [day.date, day.eventsByType])
  );
  const data = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - days + index + 1);
    const counts = dailyEvents.get(date.toISOString().slice(0, 10));
    return {
      label: date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
        year: "numeric",
      }),
      shortLabel: date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      values: {
        bounced: counts?.bounced ?? 0,
        delivered: counts?.delivered ?? 0,
        sent: counts?.sent ?? 0,
      },
    };
  });
  const stats = [
    {
      hint: "Each message counts once per recipient when accepted for sending.",
      label: "Sent",
      note: "Accepted for sending",
      value: metrics.eventsByType.sent ?? 0,
    },
    {
      hint: "The recipient's mail server accepted the message. This does not confirm it reached their inbox.",
      label: "Delivered",
      note: "Accepted by mail server",
      value: metrics.eventsByType.delivered ?? 0,
    },
    {
      hint: "Messages with a permanent delivery failure, counted once per recipient.",
      label: "Bounced",
      note: "Could not be delivered",
      value: metrics.eventsByType.bounced ?? 0,
    },
    {
      hint: "Messages whose tracking image loaded. Privacy tools and bots can inflate or hide opens. An open never proves someone read a message.",
      label: "Opened",
      note:
        openTrackingEnabled === false
          ? "Tracking is off"
          : "Estimated message opens",
      value: metrics.openedMessages,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        {stats.map((stat) => (
          <SettingsCard className="flex flex-col gap-2 p-4" key={stat.label}>
            <dt className="flex items-center justify-between gap-1 text-caption text-muted-fg">
              {stat.label}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={`About ${stat.label.toLowerCase()}`}
                      size="icon-xs"
                      variant="ghost"
                    />
                  }
                >
                  <HugeiconsIcon icon={InformationCircleIcon} />
                </TooltipTrigger>
                <TooltipContent>{stat.hint}</TooltipContent>
              </Tooltip>
            </dt>
            <dd className="flex flex-col gap-1.5">
              <span
                className={cn(
                  "text-title-lg leading-none tracking-tight tabular-nums",
                  {
                    "text-success":
                      stat.label === "Delivered" && stat.value > 0,
                    "text-warning": stat.label === "Bounced" && stat.value > 0,
                  }
                )}
              >
                {stat.value.toLocaleString()}
              </span>
              <span className="text-micro text-muted-fg">{stat.note}</span>
            </dd>
          </SettingsCard>
        ))}
      </dl>

      <SettingsCard>
        <div className="flex flex-col gap-6 p-4 @md:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-body-sm text-fg">Daily activity</h2>
            <span className="text-micro text-muted-fg">
              {data[0]?.shortLabel} to {data.at(-1)?.shortLabel}, UTC
            </span>
          </div>
          <BarChart
            data={data}
            label="Daily sent, delivered, and bounced mail"
            series={deliverySeries}
          />
        </div>
        <Separator />
        <dl className="grid grid-cols-2">
          {[
            {
              hint: "Recipients who reported spam. Future sends to them are blocked automatically.",
              label: "Complaints",
              value: metrics.eventsByType.complained ?? 0,
            },
            {
              hint: "Recipients who opted out. Future sends to them are blocked automatically.",
              label: "Unsubscribes",
              value: metrics.eventsByType.unsubscribed ?? 0,
            },
          ].map((stat) => (
            <div
              className="flex items-center gap-2 px-4 py-3 @md:px-5"
              key={stat.label}
            >
              <dt className="flex items-center gap-1 text-caption text-muted-fg">
                {stat.label}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={`About ${stat.label.toLowerCase()}`}
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <HugeiconsIcon icon={InformationCircleIcon} />
                  </TooltipTrigger>
                  <TooltipContent>{stat.hint}</TooltipContent>
                </Tooltip>
              </dt>
              <dd className="ml-auto text-body-sm text-fg tabular-nums">
                {stat.value.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsCard>
      <p className="text-micro text-muted-fg">
        Counts are per recipient, by event date. Opens are estimates per
        message.
      </p>
    </div>
  );
};
