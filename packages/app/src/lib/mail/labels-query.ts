import { getDemoLabelAutomation } from "@quieter/app/lib/demo-mail/label-automation";
import { getDemoLabels } from "@quieter/app/lib/gmail/demo-mail";
import { getManagedDemoLabels } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { rpc } from "@quieter/app/lib/orpc";
import { queryPersister } from "@quieter/app/lib/query-persister";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import { mailboxLabelSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { queryOptions } from "@tanstack/react-query";

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
        return [...getManagedDemoLabels(), ...automation.createdLabels]
          .filter((label) => !automation.deletedLabelIds.includes(label.id))
          .map((label) => ({
            ...label,
            ...automation.updatedLabels[label.id],
            autoLabel: automation.labels[label.id] ?? label.autoLabel,
          }));
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
        return [...labels, ...automation.createdLabels]
          .filter((label) => !automation.deletedLabelIds.includes(label.id))
          .map((label) => ({
            ...label,
            ...automation.updatedLabels[label.id],
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
