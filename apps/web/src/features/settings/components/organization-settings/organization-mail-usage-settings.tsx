"use client";

import { Add01Icon, Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  IconButtonTooltip,
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Switch,
  SwitchThumb,
  toast,
} from "@quieter/ui";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc, rpc } from "~/lib/orpc";

const centsPerDollar = 100;
const maximumMilestones = 10;
const suggestedMilestones = [25, 50, 75, 80, 90, 100];

type Milestone = {
  id: string;
  percent: number | null;
};

export const getOrganizationMailUsageQueryKey = (organizationId: string) =>
  ["organization-mail-usage", organizationId] as const;

export const organizationMailUsageQueryOptions = (organizationId: string, enabled = true) =>
  queryOptions({
    enabled,
    queryFn: () => rpc.organizationMailUsage.overview({ organizationId }),
    queryKey: getOrganizationMailUsageQueryKey(organizationId),
    staleTime: 30_000,
  });

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const rateFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
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
  <section className="border-b border-border/70 py-6">
    <h2 className="text-sm font-medium text-foreground">Team credits</h2>
    <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
      <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
      {message}
    </p>
  </section>
);

const ManagedUsageUnavailable = ({ message }: { message: string }) => (
  <section className="border-b border-border/70 py-6">
    <h2 className="text-sm font-medium text-foreground">Team credits</h2>
    <p className="mt-1 text-sm text-muted-foreground">{message}</p>
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
      <section className="border-b border-border/70 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-foreground">Team credits</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMoney(managedUsageCostCents)} tracked this period
            </p>
          </div>
          <span className="rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            Unlimited
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-border/70 py-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">Team credits</h2>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>Managed mail rates</span>
            {periodEnd ? <span>Resets {periodEnd}</span> : null}
          </div>
        </div>

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

        <Progress className="mt-3" max={100} value={usagePercent}>
          <ProgressTrack className="h-1.5 rounded-sm">
            <ProgressIndicator className="rounded-sm" />
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
          <div>
            <label className="text-sm font-medium text-foreground" htmlFor="managed-overage-toggle">
              Allow overage
            </label>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              When disabled, new paid usage stops after the team credits are used.
            </p>
          </div>
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
          <div>
            <p className="text-sm font-medium text-foreground">Monthly overage limit</p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Maximum usage billed above the monthly team credits.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <NumberField
              disabled={!canManageOrganizationMailUsage || !overageEnabled}
              format={{
                currency: "USD",
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
            <div>
              <p className="text-sm font-medium text-foreground">Alert milestones</p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Alerts are recorded once per billing period when usage crosses each threshold.
              </p>
            </div>

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
