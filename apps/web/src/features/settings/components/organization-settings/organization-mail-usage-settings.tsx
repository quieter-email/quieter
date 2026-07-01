"use client";

import { Add01Icon, Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@quieter/ui/number-field";
import { Progress, ProgressIndicator, ProgressTrack } from "@quieter/ui/progress";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  settingsInsetDividerClass,
  SettingsRowText,
} from "~/features/settings/components/settings-layout";
import { orpc, rpc } from "~/lib/orpc";
import {
  getOrganizationMailUsageQueryKey,
  organizationMailUsageQueryOptions,
} from "./organization-mail-usage-query";

const centsPerDollar = 100;
const maximumMilestones = 10;
const suggestedMilestones = [25, 50, 75, 80, 90, 100];

type Milestone = {
  id: string;
  percent: number | null;
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "EUR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const rateFormatter = new Intl.NumberFormat("en-US", {
  currency: "EUR",
  maximumFractionDigits: 4,
  minimumFractionDigits: 3,
  style: "currency",
});

const periodFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

const formatMoney = (cents: number | null) =>
  cents == null ? "Unlimited" : moneyFormatter.format(cents / centsPerDollar);

const formatPeriodEnd = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : periodFormatter.format(date);
};

const createInitialMilestones = (percents: number[]): Milestone[] =>
  percents.map((percent, index) => ({
    id: `saved-${index}`,
    percent,
  }));

const ManagedUsageLoading = ({ message }: { message: string }) => (
  <section className={cn(settingsInsetDividerClass, "p-4 md:px-6")}>
    <SettingsRowText title="Team credits">
      <span className="inline-flex items-center gap-2">
        <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        {message}
      </span>
    </SettingsRowText>
  </section>
);

const ManagedUsageUnavailable = ({ message }: { message: string }) => (
  <section className={cn(settingsInsetDividerClass, "p-4 md:px-6")}>
    <SettingsRowText title="Team credits">{message}</SettingsRowText>
  </section>
);

const Price = ({ label, suffix, value }: { label: string; suffix: string; value: number }) => (
  <div className="min-w-0 py-3 md:px-4 md:first:pl-0 md:last:pr-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 font-mono text-sm font-medium text-foreground">
      {rateFormatter.format(value)}
      <span className="font-sans font-normal text-muted-foreground"> {suffix}</span>
    </p>
  </div>
);

const usageBreakdownConfig = [
  {
    className: "bg-sky-500 dark:bg-sky-400",
    kind: "aiChat",
    label: "AI chat",
  },
  {
    className: "bg-amber-500 dark:bg-amber-400",
    kind: "usefulDetails",
    label: "Useful details",
  },
  {
    className: "bg-violet-500 dark:bg-violet-400",
    kind: "autoLabel",
    label: "Auto-label",
  },
  {
    className: "bg-emerald-500 dark:bg-emerald-400",
    kind: "inboundMail",
    label: "Inbound mail",
  },
  {
    className: "bg-orange-500 dark:bg-orange-400",
    kind: "outboundMail",
    label: "Outbound mail",
  },
  {
    className: "bg-muted-foreground/50",
    kind: "other",
    label: "Other",
  },
] as const;

const UsageBreakdown = ({
  breakdown,
  creditAmountCents,
}: {
  breakdown: Array<{
    costCents: number;
    kind: (typeof usageBreakdownConfig)[number]["kind"];
  }>;
  creditAmountCents: number;
}) => {
  const costs = new Map(breakdown.map((item) => [item.kind, item.costCents]));
  const items = usageBreakdownConfig.map((item) => ({
    ...item,
    costCents: costs.get(item.kind) ?? 0,
  }));
  const totalCostCents = items.reduce((total, item) => total + item.costCents, 0);
  const usedPercent =
    creditAmountCents > 0 ? Math.min(100, (totalCostCents / creditAmountCents) * 100) : 0;

  return (
    <div className="mt-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted shadow-inner ring-1 ring-border/60 squircle">
        <div className="flex h-full min-w-1 overflow-hidden" style={{ width: `${usedPercent}%` }}>
          {items.flatMap((item) => {
            if (item.costCents <= 0) return [];

            const percentage =
              totalCostCents > 0 ? Math.round((item.costCents / totalCostCents) * 100) : 0;

            return [
              <Tooltip key={item.kind}>
                <TooltipTrigger
                  className={`${item.className} min-w-1 transition-[filter] hover:brightness-110`}
                  render={<span />}
                  style={{ flexBasis: 0, flexGrow: item.costCents }}
                />
                <TooltipContent className="min-w-40 px-3 py-2">
                  <div className="flex items-center justify-between gap-5">
                    <span>{item.label}</span>
                    <span className="font-mono font-medium">
                      {moneyFormatter.format(item.costCents / centsPerDollar)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{percentage}% of usage</p>
                  <TooltipArrow />
                </TooltipContent>
              </Tooltip>,
            ];
          })}
        </div>
      </div>

      <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div className="flex min-w-0 items-center gap-2 text-xs" key={item.kind}>
            <span className={`size-2 shrink-0 rounded-full ${item.className}`} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.label}</span>
            <span className="font-mono text-foreground">
              {moneyFormatter.format(item.costCents / centsPerDollar)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ManagedUsageSettingsForm = ({
  canManageOrganizationMailUsage,
  organizationId,
  overview,
}: {
  canManageOrganizationMailUsage: boolean;
  organizationId: string;
  overview: Awaited<ReturnType<typeof rpc.organizationMailUsage.overview>>;
}) => {
  const queryClient = useQueryClient();
  const [overageEnabled, setOverageEnabled] = useState(overview.settings.overageEnabled);
  const [limitDollars, setLimitDollars] = useState<number | null>(
    overview.settings.monthlyOverageLimitCents == null
      ? null
      : overview.settings.monthlyOverageLimitCents / centsPerDollar,
  );
  const [milestones, setMilestones] = useState<Milestone[]>(() =>
    createInitialMilestones(overview.settings.alertMilestonePercents),
  );
  const updateMutation = useMutation({
    ...orpc.organizationMailUsage.updateSettings.mutationOptions(),
    mutationKey: ["organization-mail-usage", organizationId, "update"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrganizationMailUsageQueryKey(organizationId),
      });
    },
  });
  const milestonePercents = milestones.map((milestone) => milestone.percent);
  const hasDuplicateMilestone =
    new Set(milestonePercents.filter((percent) => percent != null)).size !==
    milestonePercents.filter((percent) => percent != null).length;
  const hasInvalidMilestone = milestonePercents.some(
    (percent) => percent == null || percent < 1 || percent > 100,
  );
  const milestoneError =
    (hasInvalidMilestone && "Milestones must be between 1% and 100%.") ||
    (hasDuplicateMilestone && "Each milestone must be unique.") ||
    null;
  const includedUsageCents = overview.includedManagedUsageCents ?? 0;
  const managedUsageCostCents = overview.usage.managedUsageCostCents ?? 0;
  const usagePercent =
    includedUsageCents > 0
      ? Math.min(100, Math.round((managedUsageCostCents / includedUsageCents) * 100))
      : 0;
  const limitCents = limitDollars == null ? null : Math.round(limitDollars * centsPerDollar);
  const periodEnd = formatPeriodEnd(overview.period.end);

  const updateMilestone = (id: string, percent: number | null) => {
    setMilestones((current) =>
      current.map((milestone) => (milestone.id === id ? { ...milestone, percent } : milestone)),
    );
  };

  const addMilestone = () => {
    const usedPercents = new Set(milestonePercents);
    const percent =
      suggestedMilestones.find((candidate) => !usedPercents.has(candidate)) ??
      Math.min(100, Math.max(1, (milestonePercents.at(-1) ?? 0) + 5));

    setMilestones((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        percent,
      },
    ]);
  };

  const saveSettings = async () => {
    if (milestoneError) {
      toast.error(milestoneError);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        alertMilestonePercents: milestonePercents as number[],
        monthlyOverageLimitCents: limitCents,
        organizationId,
        overageEnabled,
      });
      toast.success("Managed Usage settings updated.");
    } catch (error) {
      toast.error((error as { message?: string })?.message ?? "Could not update usage settings.");
    }
  };

  if (overview.hasUnlimitedAccess) {
    return (
      <section className={cn(settingsInsetDividerClass, "px-4 py-6 md:px-6")}>
        <div className="flex items-start justify-between gap-4">
          <SettingsRowText title="Team credits">
            {formatMoney(managedUsageCostCents)} tracked this period
          </SettingsRowText>
          <span className="rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success squircle">
            Unlimited
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={cn(settingsInsetDividerClass, "px-4 py-6 md:px-6")}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <SettingsRowText title="Team credits">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span>Managed mail rates</span>
            {periodEnd ? <span>Resets {periodEnd}</span> : null}
          </div>
        </SettingsRowText>

        {canManageOrganizationMailUsage && (
          <Button
            disabled={!!milestoneError || updateMutation.isPending}
            onClick={() => void saveSettings()}
            size="sm"
            variant="outline"
          >
            {updateMutation.isPending && (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            )}
            Save changes
          </Button>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xl font-semibold text-foreground">
              {formatMoney(managedUsageCostCents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">used across team features</p>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {formatMoney(includedUsageCents)} monthly credits
            <br />
            {formatMoney(overview.usage.billableCostCents)} overage
          </p>
        </div>

        <UsageBreakdown
          breakdown={overview.usage.breakdown}
          creditAmountCents={includedUsageCents}
        />

        <Progress className="sr-only" max={100} value={usagePercent}>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>

      <div className="mt-5 grid divide-y divide-border/70 border-y border-border/70 md:grid-cols-3 md:divide-x md:divide-y-0">
        <Price
          label="Messages"
          suffix="/ 1K"
          value={overview.managedUsageRates.messagesPerThousandDollars}
        />
        <Price
          label="Attachment data"
          suffix="/ GB"
          value={overview.managedUsageRates.attachmentDataPerGbDollars}
        />
        <Price
          label="Incoming mail processing"
          suffix="/ 1K units"
          value={overview.managedUsageRates.inboundProcessingPerThousandDollars}
        />
      </div>

      <div className="divide-y divide-border/70">
        <div className="flex items-start justify-between gap-6 py-5">
          <SettingsRowText
            className="max-w-xl"
            title={<label htmlFor="managed-overage-toggle">Allow overage</label>}
          >
            <span>When disabled, new paid usage stops after the team credits are used.</span>
          </SettingsRowText>
          <Switch
            checked={overageEnabled}
            className="mt-0.5 h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
            disabled={!canManageOrganizationMailUsage}
            id="managed-overage-toggle"
            onCheckedChange={setOverageEnabled}
          >
            <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
          </Switch>
        </div>

        <div className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
          <SettingsRowText className="max-w-xl" title="Monthly overage limit">
            <span>Maximum usage billed above the monthly team credits.</span>
          </SettingsRowText>

          <div className="flex items-center gap-2">
            <NumberField
              disabled={!canManageOrganizationMailUsage || !overageEnabled}
              format={{
                currency: "EUR",
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
                style: "currency",
              }}
              min={0}
              onValueChange={setLimitDollars}
              step={5}
              value={limitDollars}
            >
              <NumberFieldGroup className="w-44">
                <NumberFieldDecrement />
                <NumberFieldInput
                  aria-label="Monthly overage limit"
                  className="font-mono"
                  placeholder="No limit"
                />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
            <Button
              disabled={!canManageOrganizationMailUsage || !overageEnabled || limitDollars == null}
              onClick={() => setLimitDollars(null)}
              size="sm"
              variant="ghost"
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="py-5">
          <div className="flex items-start justify-between gap-4">
            <SettingsRowText className="max-w-xl" title="Alert milestones">
              <span>
                Alerts are recorded once per billing period when usage crosses each threshold.
              </span>
            </SettingsRowText>

            {canManageOrganizationMailUsage && (
              <Button
                disabled={milestones.length >= maximumMilestones}
                onClick={addMilestone}
                size="sm"
                variant="outline"
              >
                <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
                Add
              </Button>
            )}
          </div>

          <div className="mt-4 divide-y divide-border/70 border-y border-border/70">
            {milestones.map((milestone) => {
              const includedThresholdCents =
                milestone.percent == null
                  ? null
                  : Math.round(includedUsageCents * (milestone.percent / 100));
              const overageThresholdCents =
                milestone.percent == null || limitCents == null
                  ? null
                  : Math.round(limitCents * (milestone.percent / 100));

              return (
                <div
                  className="flex flex-col gap-3 py-3 md:flex-row md:items-center"
                  key={milestone.id}
                >
                  <NumberField
                    className="w-auto shrink-0"
                    disabled={!canManageOrganizationMailUsage}
                    format={{
                      maximumFractionDigits: 0,
                      style: "unit",
                      unit: "percent",
                      unitDisplay: "narrow",
                    }}
                    max={100}
                    min={1}
                    onValueChange={(value) => updateMilestone(milestone.id, value)}
                    step={5}
                    value={milestone.percent}
                  >
                    <NumberFieldGroup className="w-36">
                      <NumberFieldDecrement />
                      <NumberFieldInput aria-label="Alert milestone percentage" />
                      <NumberFieldIncrement />
                    </NumberFieldGroup>
                  </NumberField>

                  <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      <span className="font-mono text-foreground">
                        {includedThresholdCents == null
                          ? "Enter a threshold"
                          : formatMoney(includedThresholdCents)}
                      </span>{" "}
                      of monthly credits
                    </span>
                    {overageThresholdCents != null && (
                      <span>
                        <span className="font-mono text-foreground">
                          {formatMoney(overageThresholdCents)}
                        </span>{" "}
                        of the overage limit
                      </span>
                    )}
                  </div>

                  {canManageOrganizationMailUsage && (
                    <IconButtonTooltip label="Remove milestone">
                      <Button
                        aria-label="Remove milestone"
                        disabled={milestones.length === 1}
                        onClick={() =>
                          setMilestones((current) =>
                            current.filter((candidate) => candidate.id !== milestone.id),
                          )
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                      </Button>
                    </IconButtonTooltip>
                  )}
                </div>
              );
            })}
          </div>

          {milestoneError && <p className="mt-2 text-xs text-destructive">{milestoneError}</p>}
        </div>
      </div>

      {!canManageOrganizationMailUsage && (
        <p className="mt-4 text-xs text-muted-foreground">
          Only admins and owners can change team credit settings.
        </p>
      )}
    </section>
  );
};

export const OrganizationMailUsageSettings = ({
  billingAccessUnknown,
  billingPending,
  canManageOrganizationMailUsage,
  canUseOrganizationMail,
  organizationId,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageOrganizationMailUsage: boolean;
  canUseOrganizationMail: boolean;
  organizationId: string;
}) => {
  const {
    data: usage,
    error: usageError,
    isError: isUsageError,
    isPending: isUsagePending,
  } = useQuery(organizationMailUsageQueryOptions(organizationId, canUseOrganizationMail));

  if (billingPending) {
    return <ManagedUsageLoading message="Loading billing access…" />;
  }

  if (billingAccessUnknown) {
    return <ManagedUsageUnavailable message="Could not load billing access." />;
  }

  if (!canUseOrganizationMail) {
    return <ManagedUsageUnavailable message="Available with Team billing." />;
  }

  if (isUsagePending) {
    return <ManagedUsageLoading message="Loading usage…" />;
  }

  if (isUsageError) {
    return (
      <ManagedUsageUnavailable message={usageError.message ?? "Could not load Managed Usage."} />
    );
  }

  if (!usage.hasAccess) {
    return <ManagedUsageUnavailable message="Available with Team billing." />;
  }

  return (
    <ManagedUsageSettingsForm
      canManageOrganizationMailUsage={canManageOrganizationMailUsage}
      key={[
        usage.settings.overageEnabled,
        usage.settings.monthlyOverageLimitCents,
        usage.settings.alertMilestonePercents.join("-"),
      ].join(":")}
      organizationId={organizationId}
      overview={usage}
    />
  );
};
