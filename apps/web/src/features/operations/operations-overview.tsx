import {
  AiChat01Icon,
  CreditCardIcon,
  Mail01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { orpc } from "@quieter/app/lib/orpc";
import type { rpc } from "@quieter/app/lib/orpc";
import { BarChart } from "@quieter/ui/bar-chart";
import type { BarChartPoint, BarChartSeries } from "@quieter/ui/bar-chart";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { CompositionChart } from "@quieter/ui/composition-chart";
import { Icon } from "@quieter/ui/icon";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Toggle, ToggleGroup } from "@quieter/ui/toggle";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";

type Overview = Awaited<ReturnType<typeof rpc.operations.overview>>;
type Range = Parameters<typeof rpc.operations.overview>[0]["days"];
type ActivityKey = Exclude<keyof Overview["daily"][number], "date">;
type ActivitySeries = BarChartSeries & { key: ActivityKey };

const ranges = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: "all", label: "All" },
] as const satisfies readonly { days: Range; label: string }[];
type SelectedRange = (typeof ranges)[number];

const chartSkeletonHeights = [42, 68, 51, 84, 60, 47, 76, 55];
const pulseClass =
  "animate-pulse rounded-md bg-muted not-squircle motion-reduce:animate-none";
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
      label:
        first.date === last.date
          ? longDate.format(firstDate)
          : longDate.formatRange(firstDate, lastDate),
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

const bucketSizeFor = (pointCount: number) =>
  pointCount <= 12 ? 1 : Math.ceil(pointCount / 12);

const periodPhrase = (days: Range) =>
  days === "all" ? "all time" : `the last ${days} days`;

const activityCaption = (bucketSize: number) => {
  const grouping =
    bucketSize === 1 ? "Daily" : `Up to ${bucketSize} days per group`;
  return `${grouping}, UTC`;
};

type SkeletonStyle = CSSProperties & { "--skeleton-size"?: string };

const ChartSkeleton = ({ label }: { label: string }) => (
  <output aria-label={label} className="flex h-48 items-end gap-2">
    <span className="sr-only">{label}</span>
    {chartSkeletonHeights.map((height) => (
      <span
        aria-hidden
        className={cn(pulseClass, "h-(--skeleton-size) w-full rounded-t-sm")}
        key={height}
        style={{ "--skeleton-size": `${height}%` } as SkeletonStyle}
      />
    ))}
  </output>
);

const MetricSkeleton = ({ label }: { label: string }) => (
  <output aria-label={label} className="block">
    <span className="sr-only">{label}</span>
    <span aria-hidden className={cn(pulseClass, "block h-8 w-16")} />
  </output>
);

const MixSkeleton = ({ label }: { label: string }) => (
  <output aria-label={label} className="block space-y-4">
    <span className="sr-only">{label}</span>
    <span aria-hidden className={cn(pulseClass, "block h-2.5 w-full")} />
    <span className="block space-y-2">
      {["mix-a", "mix-b", "mix-c"].map((key) => (
        <span
          aria-hidden
          className={cn(pulseClass, "block h-4 w-full")}
          key={key}
        />
      ))}
    </span>
  </output>
);

const BreakdownCard = ({
  children,
  description,
  failed,
  label,
  loading,
}: {
  children: ReactElement | null;
  description: string;
  failed: boolean;
  label: string;
  loading: boolean;
}) => {
  if (loading) {
    return (
      <Surface className="min-w-0" padding="comfortable">
        <div className="space-y-4">
          <header className="space-y-1">
            <Text as="h3" size="sm" weight="medium">
              {label}
            </Text>
            <Text size="caption" tone="muted">
              {description}
            </Text>
          </header>
          <MixSkeleton label={`Loading ${label}`} />
        </div>
      </Surface>
    );
  }
  if (failed) {
    return (
      <Surface className="min-w-0" padding="comfortable">
        <Text size="caption" tone="muted">
          {label} didn’t load.
        </Text>
      </Surface>
    );
  }
  return children;
};

const MetricFigure = ({
  label,
  skeleton,
  unavailable,
  value,
}: {
  label: string;
  skeleton: boolean;
  unavailable: boolean;
  value: number | undefined;
}) => {
  if (skeleton) {
    return <MetricSkeleton label={`Loading ${label}`} />;
  }
  if (unavailable || value === undefined) {
    return (
      <Text as="span" size="caption" tone="muted">
        Unavailable
      </Text>
    );
  }
  return value.toLocaleString();
};

const ActivityChartBody = ({
  bucketSize,
  data,
  failed,
  loading,
  series,
  title,
}: {
  bucketSize: number;
  data: Overview | undefined;
  failed: boolean;
  loading: boolean;
  series: ActivitySeries[];
  title: string;
}) => {
  if (loading) {
    return <ChartSkeleton label={`Loading ${title}`} />;
  }
  if (failed || data === undefined) {
    return (
      <Text size="caption" tone="muted">
        This chart didn’t load.
      </Text>
    );
  }
  return (
    <BarChart
      data={chartPoints(data.daily, series, bucketSize)}
      label={title}
      series={series}
    />
  );
};

const OverviewMetrics = ({
  bucketSize,
  data,
  range,
  rangeFailed,
  rangeLoading,
}: {
  bucketSize: number;
  data: Overview | undefined;
  range: Range;
  rangeFailed: boolean;
  rangeLoading: boolean;
}) => {
  const kpis = data?.kpis;
  const cards = [
    {
      caption:
        kpis === undefined
          ? "Finished onboarding"
          : `${kpis.completedOnboardingUsers.toLocaleString()} finished onboarding`,
      followsRange: false,
      icon: UserGroupIcon,
      label: "Accounts",
      value: kpis?.totalUsers,
    },
    {
      caption: "Across all mailbox types",
      followsRange: false,
      icon: Mail01Icon,
      label: "Connected mailboxes",
      value: kpis?.connectedMailboxes,
    },
    {
      caption: "Includes subscriptions in trial",
      followsRange: false,
      icon: CreditCardIcon,
      label: "Active subscriptions",
      value: kpis?.activeSubscriptions,
    },
    {
      caption: range === "all" ? "All time" : `Last ${range} days`,
      followsRange: true,
      icon: AiChat01Icon,
      label: "AI usage events",
      value: kpis?.aiUsageEvents,
    },
  ];
  const mailboxDescription =
    range === "all"
      ? "All mailboxes, including disconnected mailboxes."
      : `Mailboxes created in ${periodPhrase(range)}, including disconnected mailboxes.`;
  const subscriptionDescription =
    range === "all"
      ? "Active and trial subscriptions by plan."
      : `Active and trial subscriptions started in ${periodPhrase(range)}.`;
  return (
    <div className="space-y-6">
      <Surface padding="comfortable">
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {cards.map(({ caption, followsRange, icon, label, value }) => {
            const skeleton = followsRange
              ? rangeLoading
              : value === undefined && !rangeFailed;
            const unavailable = followsRange
              ? !rangeLoading && (rangeFailed || value === undefined)
              : value === undefined;
            return (
              <div className="min-w-0 space-y-1.5" key={label}>
                <dt className="flex items-center gap-2 text-caption text-muted-fg">
                  <Icon
                    className="shrink-0"
                    icon={icon}
                    size={14}
                    tone="muted"
                  />
                  {label}
                </dt>
                <dd className="text-title-lg tabular-nums">
                  <MetricFigure
                    label={label}
                    skeleton={skeleton}
                    unavailable={unavailable}
                    value={value}
                  />
                </dd>
                <dd className="text-micro text-muted-fg">{caption}</dd>
              </div>
            );
          })}
        </dl>
      </Surface>
      <section aria-labelledby="operations-activity" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Text as="h2" id="operations-activity" size="sm" weight="medium">
            Activity
          </Text>
          <Text size="caption" tone="muted">
            {rangeLoading ? periodPhrase(range) : activityCaption(bucketSize)}
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
                <ActivityChartBody
                  bucketSize={bucketSize}
                  data={data}
                  failed={rangeFailed}
                  loading={rangeLoading}
                  series={series}
                  title={title}
                />
              </div>
            </Surface>
          ))}
        </div>
      </section>
      <section aria-labelledby="operations-breakdown" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Text as="h2" id="operations-breakdown" size="sm" weight="medium">
            Breakdown
          </Text>
          <Text size="caption" tone="muted">
            {periodPhrase(range)}
          </Text>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <BreakdownCard
            description={mailboxDescription}
            failed={rangeFailed || data === undefined}
            label="Mailbox mix"
            loading={rangeLoading}
          >
            {data === undefined ? null : (
              <CompositionChart
                description={mailboxDescription}
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
            )}
          </BreakdownCard>
          <BreakdownCard
            description={subscriptionDescription}
            failed={rangeFailed || data === undefined}
            label="Subscription mix"
            loading={rangeLoading}
          >
            {data === undefined ? null : (
              <CompositionChart
                description={subscriptionDescription}
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
            )}
          </BreakdownCard>
        </div>
      </section>
    </div>
  );
};

const RangeStatus = ({
  asOf,
  failed,
  fetching,
  onRetry,
}: {
  asOf: string | undefined;
  failed: boolean;
  fetching: boolean;
  onRetry: () => void;
}) => {
  if (failed) {
    return (
      <div className="flex items-center gap-3">
        <Text role="alert" size="caption" tone="destructive">
          Couldn’t load activity.
        </Text>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Try again
        </Button>
      </div>
    );
  }
  if (asOf === undefined) {
    return null;
  }
  const label = fetching ? "Updating" : "Updated";
  return (
    <Text size="caption" tone="muted">
      {label}{" "}
      {new Date(asOf).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}
    </Text>
  );
};

export const OperationsOverview = () => {
  const [range, setRange] = useState<SelectedRange>(ranges[1]);
  const overview = useQuery({
    ...orpc.operations.overview.queryOptions({
      gcTime: 0,
      input: { days: range.days },
      staleTime: 30_000,
    }),
    placeholderData: keepPreviousData,
  });
  const rangeLoading =
    overview.isPending || (overview.isPlaceholderData && !overview.isError);
  const rangeFailed = overview.isError;
  const bucketSize = bucketSizeFor(overview.data?.daily.length ?? 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          aria-label="Reporting period"
          onValueChange={(values) => {
            const next = ranges.find(({ days }) => String(days) === values[0]);
            if (next !== undefined) {
              setRange(next);
            }
          }}
          size="compact"
          value={[String(range.days)]}
          variant="subtle"
        >
          {ranges.map(({ days, label }) => (
            <Toggle key={days} size="compact" value={String(days)}>
              {label}
            </Toggle>
          ))}
        </ToggleGroup>
        <RangeStatus
          asOf={overview.data?.asOf}
          failed={rangeFailed}
          fetching={overview.isFetching}
          onRetry={() => void overview.refetch()}
        />
      </div>
      <OverviewMetrics
        bucketSize={bucketSize}
        data={overview.data}
        range={range.days}
        rangeFailed={rangeFailed}
        rangeLoading={rangeLoading}
      />
    </div>
  );
};
