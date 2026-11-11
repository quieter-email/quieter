import {
  AiChat01Icon,
  CreditCardIcon,
  Mail01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import {
  SettingsErrorState,
  SettingsLoadingState,
} from "@quieter/app/features/settings/components/settings-layout";
import { orpc } from "@quieter/app/lib/orpc";
import type { rpc } from "@quieter/app/lib/orpc";
import { BarChart } from "@quieter/ui/bar-chart";
import type { BarChartPoint, BarChartSeries } from "@quieter/ui/bar-chart";
import { CompositionChart } from "@quieter/ui/composition-chart";
import { Icon } from "@quieter/ui/icon";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Toggle, ToggleGroup } from "@quieter/ui/toggle";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type Overview = Awaited<ReturnType<typeof rpc.operations.overview>>;
type Days = Parameters<typeof rpc.operations.overview>[0]["days"];
type ActivityKey = Exclude<keyof Overview["daily"][number], "date">;
type ActivitySeries = BarChartSeries & { key: ActivityKey };

const periods = [
  { days: 7, groupBy: 1 },
  { days: 30, groupBy: 3 },
  { days: 90, groupBy: 7 },
] as const satisfies readonly { days: Days; groupBy: number }[];
type Period = (typeof periods)[number];
const shortDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const activityCharts: {
  description: string;
  series: ActivitySeries[];
  title: string;
}[] = [
  {
    description: "New Quieter accounts and waitlist signups.",
    series: [
      { color: "var(--q-blue)", key: "newUsers", label: "New accounts" },
      {
        color: "var(--q-purple)",
        key: "waitlistSignups",
        label: "Waitlist signups",
      },
    ],
    title: "Growth",
  },
  {
    description: "Incoming messages and outgoing recipients on managed mail.",
    series: [
      {
        color: "var(--q-cyan)",
        key: "managedInboundMessages",
        label: "Incoming messages",
      },
      {
        color: "var(--q-blue)",
        key: "managedOutboundRecipients",
        label: "Outgoing recipients",
      },
    ],
    title: "Managed mail",
  },
  {
    description: "AI usage events recorded for billing.",
    series: [
      {
        color: "var(--q-purple)",
        key: "aiUsageEvents",
        label: "AI usage events",
      },
    ],
    title: "AI activity",
  },
  {
    description: "Credits used, including usage covered by a plan.",
    series: [
      {
        color: "var(--q-pink)",
        key: "aiUsageCredits",
        label: "Credits used",
        valueFormat: { maximumFractionDigits: 6 },
      },
    ],
    title: "AI credit usage",
  },
];

const chartPoints = (
  daily: Overview["daily"],
  series: ActivitySeries[],
  bucketSize: number
): BarChartPoint[] => {
  const points: BarChartPoint[] = [];
  for (let start = 0; start < daily.length; start += bucketSize) {
    const bucket = daily.slice(start, start + bucketSize);
    const [first] = bucket;
    const last = bucket.at(-1);
    if (first === undefined || last === undefined) {
      break;
    }
    const firstDate = new Date(first.date);
    const lastDate = new Date(last.date);
    points.push({
      label: longDate.formatRange(firstDate, lastDate),
      shortLabel: shortDate.format(firstDate),
      values: Object.fromEntries(
        series.map(({ key }) => [
          key,
          bucket.reduce((total, point) => total + point[key], 0),
        ])
      ),
    });
  }
  return points;
};

const OverviewMetrics = ({
  bucketSize,
  data,
}: {
  bucketSize: number;
  data: Overview;
}) => {
  const { kpis } = data;
  const cards = [
    {
      caption: `${kpis.completedOnboardingUsers.toLocaleString()} finished onboarding`,
      icon: UserGroupIcon,
      label: "Accounts",
      value: kpis.totalUsers,
    },
    {
      caption: "Across all mailbox types",
      icon: Mail01Icon,
      label: "Connected mailboxes",
      value: kpis.connectedMailboxes,
    },
    {
      caption: "Includes subscriptions in trial",
      icon: CreditCardIcon,
      label: "Active subscriptions",
      value: kpis.activeSubscriptions,
    },
    {
      caption: `Last ${data.daily.length} days`,
      icon: AiChat01Icon,
      label: "AI usage events",
      value: kpis.aiUsageEvents,
    },
  ];
  return (
    <div className="space-y-6">
      <Surface padding="comfortable">
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {cards.map(({ caption, icon, label, value }) => (
            <div className="min-w-0 space-y-1.5" key={label}>
              <dt className="flex items-center gap-2 text-caption text-muted-fg">
                <Icon className="shrink-0" icon={icon} size={14} tone="muted" />
                {label}
              </dt>
              <dd className="text-title-lg tabular-nums">
                {value.toLocaleString()}
              </dd>
              <dd className="text-micro text-muted-fg">{caption}</dd>
            </div>
          ))}
        </dl>
      </Surface>
      <section aria-labelledby="operations-activity" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Text as="h2" id="operations-activity" size="sm" weight="medium">
            Activity
          </Text>
          <Text size="caption" tone="muted">
            {bucketSize === 1 ? "Daily" : `Up to ${bucketSize} days per group`},
            UTC
          </Text>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {activityCharts.map(({ description, series, title }) => (
            <Surface className="min-w-0" key={title} padding="comfortable">
              <div className="space-y-4">
                <header className="space-y-1">
                  <Text as="h3" size="sm" weight="medium">
                    {title}
                  </Text>
                  <Text size="caption" tone="muted">
                    {description}
                  </Text>
                </header>
                <BarChart
                  data={chartPoints(data.daily, series, bucketSize)}
                  label={title}
                  series={series}
                />
              </div>
            </Surface>
          ))}
        </div>
      </section>
      <section aria-labelledby="operations-breakdown" className="space-y-3">
        <Text as="h2" id="operations-breakdown" size="sm" weight="medium">
          Current breakdown
        </Text>
        <div className="grid gap-3 lg:grid-cols-2">
          <CompositionChart
            description="All mailboxes, including disconnected mailboxes."
            segments={[
              {
                color: "var(--q-blue)",
                label: "Gmail",
                value: data.mailboxMix.gmail,
              },
              {
                color: "var(--q-cyan)",
                label: "Managed private",
                value: data.mailboxMix.managedPrivate,
              },
              {
                color: "var(--q-purple)",
                label: "Managed shared",
                value: data.mailboxMix.managedShared,
              },
            ]}
            title="Mailbox mix"
          />
          <CompositionChart
            description="Active and trial subscriptions by plan."
            segments={[
              {
                color: "var(--q-purple)",
                label: "Pro",
                value: data.subscriptionMix.pro,
              },
              {
                color: "var(--q-cyan)",
                label: "Managed",
                value: data.subscriptionMix.managed,
              },
            ]}
            title="Subscription mix"
          />
        </div>
      </section>
    </div>
  );
};

export const OperationsOverview = () => {
  const [period, setPeriod] = useState<Period>(periods[1]);
  const overview = useQuery(
    orpc.operations.overview.queryOptions({
      gcTime: 0,
      input: { days: period.days },
      staleTime: 30_000,
    })
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          aria-label="Reporting period"
          onValueChange={(values) => {
            const next = periods.find(({ days }) => String(days) === values[0]);
            if (next !== undefined) {
              setPeriod(next);
            }
          }}
          size="compact"
          value={[String(period.days)]}
          variant="subtle"
        >
          {periods.map(({ days }) => (
            <Toggle key={days} size="compact" value={String(days)}>
              {days} days
            </Toggle>
          ))}
        </ToggleGroup>
        {overview.data !== undefined && !overview.isError && (
          <Text size="caption" tone="muted">
            Updated{" "}
            {new Date(overview.data.asOf).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        )}
      </div>
      {overview.isPending && (
        <Surface padding="none">
          <SettingsLoadingState className="min-h-48" label="Loading activity" />
        </Surface>
      )}
      {overview.isError && (
        <SettingsErrorState
          message="Couldn’t load activity."
          onRetry={() => void overview.refetch()}
        />
      )}
      {overview.isSuccess && (
        <OverviewMetrics bucketSize={period.groupBy} data={overview.data} />
      )}
    </div>
  );
};
