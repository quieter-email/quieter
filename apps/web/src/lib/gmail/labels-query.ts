import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";
import { queryPersister } from "#/lib/query-persister";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

import { getManagedDemoLabels } from "../managed-mail/demo-managed-mail";
import { getDemoLabels } from "./demo-mail";

export const getLabelsQueryKey = (mailboxId: string) =>
  ["gmail-labels", mailboxId] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMailboxLabel = (value: unknown): value is MailboxLabel => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.inclusionCriteria === "string" &&
    typeof value.position === "number" &&
    (value.provider === "gmail" || value.provider === "managed") &&
    (value.type === "system" || value.type === "user") &&
    typeof value.visible === "boolean" &&
    (value.color === null ||
      mailboxLabelColorSchema.safeParse(value.color).success)
  );
};

const normalizeMailboxLabels = (value: unknown): MailboxLabel[] =>
  Array.isArray(value) ? value.filter(isMailboxLabel) : [];

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<MailboxLabel[]>({
    enabled,
    persister: queryPersister.persisterFn,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoLabels();
      }

      if (isSandboxMailboxId(mailboxId)) {
        return getDemoLabels().map((label, position) => ({
          ...label,
          color: label.color ?? null,
          description: label.description ?? null,
          inclusionCriteria: label.inclusionCriteria ?? null,
          position,
          provider: "gmail" as const,
          type:
            label.type === "system" ? ("system" as const) : ("user" as const),
          visible: true,
        }));
      }
      return normalizeMailboxLabels(
        await rpc.mail.listLabels({ mailboxId }, { signal })
      );
    },
    queryKey: getLabelsQueryKey(mailboxId),
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: 1000 * 60 * 5,
  });
