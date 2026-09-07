import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

const MAIL_SUPPRESSIONS_LIMIT = 100;

export const getOrganizationMailSuppressionsQueryKey = (
  organizationId: string
) => ["organization", organizationId, "mail-suppressions"] as const;

export const getOrganizationMailSuppressionAuditQueryKey = (
  organizationId: string
) => ["organization", organizationId, "mail-suppression-audit"] as const;

export const organizationMailSuppressionsQueryOptions = (
  organizationId: string
) =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.organization.listMailRecipientSuppressions(
        { limit: MAIL_SUPPRESSIONS_LIMIT, organizationId },
        { signal }
      ),
    queryKey: getOrganizationMailSuppressionsQueryKey(organizationId),
    staleTime: 30_000,
  });

export const organizationMailSuppressionAuditQueryOptions = (
  organizationId: string
) =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.organization.listMailSuppressionAudit(
        { limit: MAIL_SUPPRESSIONS_LIMIT, organizationId },
        { signal }
      ),
    queryKey: getOrganizationMailSuppressionAuditQueryKey(organizationId),
    staleTime: 30_000,
  });
