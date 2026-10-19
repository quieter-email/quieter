import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const getMailTrackingSettingsQueryKey = (organizationId: string) =>
  ["organization", organizationId, "mail-tracking-settings"] as const;

export const mailTrackingSettingsQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.organization.getMailTrackingSettings(
        { organizationId },
        { signal }
      ),
    queryKey: getMailTrackingSettingsQueryKey(organizationId),
    staleTime: 30_000,
  });

export type MailDeliveryMetricsRange = "30d" | "7d";

const RANGE_DAYS: Record<MailDeliveryMetricsRange, number> = {
  "30d": 30,
  "7d": 7,
};

const getMailDeliveryMetricsQueryKey = (
  organizationId: string,
  range: MailDeliveryMetricsRange,
  mailboxId?: string
) =>
  [
    "organization",
    organizationId,
    "mail-delivery-metrics",
    range,
    mailboxId ?? "",
  ] as const;

export const mailDeliveryMetricsQueryOptions = (
  organizationId: string,
  range: MailDeliveryMetricsRange,
  mailboxId?: string
) =>
  queryOptions({
    queryFn: async ({ signal }) => {
      const to = new Date();
      const from = new Date(to);
      from.setUTCHours(0, 0, 0, 0);
      from.setUTCDate(from.getUTCDate() - RANGE_DAYS[range] + 1);
      const metrics = await rpc.organization.getMailDeliveryMetrics(
        {
          from,
          organizationId,
          to,
          ...(mailboxId !== undefined && mailboxId !== "" ? { mailboxId } : {}),
        },
        { signal }
      );
      return { ...metrics, to };
    },
    queryKey: getMailDeliveryMetricsQueryKey(organizationId, range, mailboxId),
    staleTime: 60_000,
  });
