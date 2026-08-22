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

export const getMailDeliveryMetricsQueryKey = (
  organizationId: string,
  range: MailDeliveryMetricsRange
) => ["organization", organizationId, "mail-delivery-metrics", range] as const;

export const mailDeliveryMetricsQueryOptions = (
  organizationId: string,
  range: MailDeliveryMetricsRange
) => {
  const from = new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
  return queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.organization.getMailDeliveryMetrics(
        { from, organizationId },
        { signal }
      ),
    queryKey: getMailDeliveryMetricsQueryKey(organizationId, range),
    staleTime: 60_000,
  });
};
