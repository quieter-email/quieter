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
    queryFn: async ({ signal }) =>
      await rpc.organization.getMailDeliveryMetrics(
        {
          organizationId,
          range,
          ...(mailboxId !== undefined && mailboxId !== "" ? { mailboxId } : {}),
        },
        { signal }
      ),
    queryKey: getMailDeliveryMetricsQueryKey(organizationId, range, mailboxId),
    staleTime: 60_000,
  });
