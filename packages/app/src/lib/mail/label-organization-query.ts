import { rpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import {
  applyLabelOrganizationAction,
  emptyLabelOrganization,
  flattenLabelOrganization,
  labelOrganizationActionSchema,
  labelOrganizationSchema,
} from "@quieter/mail/mailbox-organization";
import type { LabelOrganizationAction } from "@quieter/mail/mailbox-organization";
import { queryOptions } from "@tanstack/react-query";

const readDemoOrganization = (mailboxId: string) => {
  const storageKey = `quieter:label-organization:${mailboxId}`;
  const stored = globalThis.window?.localStorage.getItem(storageKey);
  if (stored) {
    try {
      return flattenLabelOrganization(
        labelOrganizationSchema.parse(JSON.parse(stored))
      );
    } catch {
      globalThis.window?.localStorage.removeItem(storageKey);
    }
  }
  return emptyLabelOrganization;
};

export const labelOrganizationQueryOptions = (
  mailboxId: string,
  enabled = true
) =>
  queryOptions({
    enabled,
    queryFn: async ({ signal }) =>
      isSandboxMailboxId(mailboxId)
        ? readDemoOrganization(mailboxId)
        : await rpc.mail.getLabelOrganization({ mailboxId }, { signal }),
    queryKey: ["label-organization", mailboxId] as const,
    staleTime: 60_000,
  });

export const updateLabelOrganization = async (
  mailboxId: string,
  action: LabelOrganizationAction
) => {
  if (!isSandboxMailboxId(mailboxId)) {
    return await rpc.mail.updateLabelOrganization({ action, mailboxId });
  }
  const organization = applyLabelOrganizationAction(
    readDemoOrganization(mailboxId),
    labelOrganizationActionSchema.parse(action),
    crypto.randomUUID()
  );
  if (typeof organization === "string") {
    throw new TypeError(organization);
  }
  window.localStorage.setItem(
    `quieter:label-organization:${mailboxId}`,
    JSON.stringify(organization)
  );
  return organization;
};
