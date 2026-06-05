"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Input, Switch, SwitchThumb, toast } from "@quieter/ui";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc, rpc } from "~/lib/orpc";
import { SettingsRow } from "./settings-row";

const centsPerDollar = 100;

export const getTeamMailUsageQueryKey = (organizationId: string) =>
  ["team-mail-usage", organizationId] as const;

export const teamMailUsageQueryOptions = (organizationId: string, enabled = true) =>
  queryOptions({
    enabled,
    queryFn: () => rpc.teamMailUsage.overview({ organizationId }),
    queryKey: getTeamMailUsageQueryKey(organizationId),
    staleTime: 30_000,
  });

const moneyFormatter = new Intl.NumberFormat("en", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const formatMoney = (cents: number | null) =>
  cents == null ? "Unlimited" : moneyFormatter.format(cents / centsPerDollar);

const parseLimitCents = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) {
    throw new Error("Enter a valid overage limit.");
  }

  return Math.round(dollars * centsPerDollar);
};

const parseMilestones = (value: string) => {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const milestones = Array.from(new Set(parts.map((part) => Number(part)).map(Math.round))).sort(
    (left, right) => left - right,
  );

  if (
    milestones.length === 0 ||
    milestones.length > 10 ||
    milestones.some((milestone) => !Number.isFinite(milestone) || milestone <= 0 || milestone > 100)
  ) {
    throw new Error("Add at least one alert milestone between 1 and 100.");
  }

  return milestones;
};

const TeamMailUsageSettingsForm = ({
  canManageTeamMailUsage,
  organizationId,
  overview,
}: {
  canManageTeamMailUsage: boolean;
  organizationId: string;
  overview: Awaited<ReturnType<typeof rpc.teamMailUsage.overview>>;
}) => {
  const queryClient = useQueryClient();
  const [overageEnabled, setOverageEnabled] = useState(overview.settings.overageEnabled);
  const [limit, setLimit] = useState(
    overview.settings.monthlyOverageLimitCents == null
      ? ""
      : String(overview.settings.monthlyOverageLimitCents / centsPerDollar),
  );
  const [milestones, setMilestones] = useState(overview.settings.alertMilestonePercents.join(", "));
  const updateMutation = useMutation({
    ...orpc.teamMailUsage.updateSettings.mutationOptions(),
    mutationKey: ["team-mail-usage", organizationId, "update"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getTeamMailUsageQueryKey(organizationId),
      });
    },
  });
  const usageSummary = [
    `${formatMoney(overview.usage.sesCostCents)} of ${formatMoney(
      overview.includedSesUsageCents,
    )} included SES usage`,
    `${formatMoney(overview.usage.billableCostCents)} billable overage`,
  ].join(" · ");

  const saveSettings = async () => {
    try {
      await updateMutation.mutateAsync({
        alertMilestonePercents: parseMilestones(milestones),
        monthlyOverageLimitCents: overageEnabled ? parseLimitCents(limit) : null,
        organizationId,
        overageEnabled,
      });
      toast.success("Team mail usage settings updated.");
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Could not update usage settings.");
      }
    }
  };

  return (
    <SettingsRow
      action={
        <Button
          disabled={!canManageTeamMailUsage || updateMutation.isPending}
          onClick={() => void saveSettings()}
          size="sm"
          variant="outline"
        >
          {updateMutation.isPending && (
            <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          )}
          Save
        </Button>
      }
      label="SES usage"
      value={
        <div className="max-w-2xl space-y-3">
          <p>{usageSummary}</p>

          <div className="grid gap-3 md:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(12rem,1fr)]">
            <label className="flex items-center gap-3 text-sm text-foreground">
              <Switch
                checked={overageEnabled}
                className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                disabled={!canManageTeamMailUsage}
                onCheckedChange={setOverageEnabled}
              >
                <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
              </Switch>
              Overage
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-foreground">Monthly cap</span>
              <Input
                disabled={!canManageTeamMailUsage || !overageEnabled}
                inputMode="decimal"
                onChange={(event) => setLimit(event.target.value)}
                placeholder="No cap"
                size="sm"
                value={limit}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-foreground">Alert milestones</span>
              <Input
                disabled={!canManageTeamMailUsage}
                onChange={(event) => setMilestones(event.target.value)}
                placeholder="50, 80, 100"
                size="sm"
                value={milestones}
              />
            </label>
          </div>

          {!overageEnabled && (
            <p className="text-xs text-muted-foreground">
              Sends fail once included SES usage is exhausted.
            </p>
          )}

          {!canManageTeamMailUsage && (
            <p className="text-xs text-muted-foreground">
              Only admins and owners can change usage limits.
            </p>
          )}
        </div>
      }
    />
  );
};

export const TeamMailUsageSettings = ({
  canManageTeamMailUsage,
  canUseTeamMail,
  organizationId,
}: {
  canManageTeamMailUsage: boolean;
  canUseTeamMail: boolean;
  organizationId: string;
}) => {
  const usageQuery = useQuery(teamMailUsageQueryOptions(organizationId, canUseTeamMail));

  if (!canUseTeamMail) {
    return <SettingsRow action={null} label="SES usage" value="Requires managed" />;
  }

  if (usageQuery.isPending) {
    return (
      <SettingsRow
        action={null}
        label="SES usage"
        value={
          <span className="inline-flex items-center gap-2">
            <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            Loading usage…
          </span>
        }
      />
    );
  }

  if (usageQuery.isError) {
    return (
      <SettingsRow
        action={null}
        label="SES usage"
        value={usageQuery.error.message ?? "Could not load usage settings."}
      />
    );
  }

  if (!usageQuery.data.hasAccess) {
    return <SettingsRow action={null} label="SES usage" value="Requires managed" />;
  }

  return (
    <TeamMailUsageSettingsForm
      canManageTeamMailUsage={canManageTeamMailUsage}
      key={[
        usageQuery.data.settings.overageEnabled,
        usageQuery.data.settings.monthlyOverageLimitCents,
        usageQuery.data.settings.alertMilestonePercents.join("-"),
      ].join(":")}
      organizationId={organizationId}
      overview={usageQuery.data}
    />
  );
};
