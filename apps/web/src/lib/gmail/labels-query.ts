import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { isSandboxMailboxId, getDemoLabels } from "./demo-mail";

export const getLabelsQueryKey = (mailboxId: string) => ["gmail-labels", mailboxId] as const;

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<MailboxLabel[]>({
    queryKey: getLabelsQueryKey(mailboxId),
    queryFn: async ({ signal }) => {
      if (isSandboxMailboxId(mailboxId)) {
        return getDemoLabels().map((label, position) => ({
          ...label,
          color: null,
          description: null,
          inclusionCriteria: null,
          position,
          provider: "gmail" as const,
          type: label.type === "system" ? ("system" as const) : ("user" as const),
          visible: true,
        }));
      }
      return (await rpc.mail.listLabels({ mailboxId }, { signal })) as MailboxLabel[];
    },
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
