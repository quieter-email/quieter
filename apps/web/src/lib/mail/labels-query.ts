import { mailboxLabelSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";
import { queryPersister } from "#/lib/query-persister";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

import { getDemoLabelAutomation } from "../demo-mail/label-automation";
import { getDemoLabels } from "../gmail/demo-mail";
import { getManagedDemoLabels } from "../managed-mail/demo-managed-mail";

export const getLabelsQueryKey = (mailboxId: string) =>
  ["gmail-labels", mailboxId] as const;

const normalizeMailboxLabels = (value: unknown): MailboxLabel[] =>
  Array.isArray(value)
    ? value.flatMap((label) => {
        const parsed = mailboxLabelSchema.safeParse(label);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<MailboxLabel[]>({
    enabled,
    persister: queryPersister.persisterFn,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        const automation = getDemoLabelAutomation(mailboxId);
        return [...getManagedDemoLabels(), ...automation.createdLabels].map(
          (label) => ({
            ...label,
            autoLabel: automation.labels[label.id] ?? label.autoLabel,
          })
        );
      }

      if (isSandboxMailboxId(mailboxId)) {
        const automation = getDemoLabelAutomation(mailboxId);
        const labels: MailboxLabel[] = getDemoLabels().map(
          (label, position) => ({
            ...label,
            autoLabel: automation.labels[label.id] ?? null,
            color: label.color ?? null,
            description: label.description ?? null,
            inclusionCriteria: label.inclusionCriteria ?? null,
            position,
            provider: "gmail" as const,
            type:
              label.type === "system" ? ("system" as const) : ("user" as const),
            visible: true,
          })
        );
        return [...labels, ...automation.createdLabels].map((label) => ({
          ...label,
          autoLabel: automation.labels[label.id] ?? label.autoLabel,
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
