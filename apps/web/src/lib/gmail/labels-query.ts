import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { DEMO_MAILBOX_ID, getDemoLabels } from "./demo-mail";

export const getLabelsQueryKey = (mailboxId: string) => ["gmail-labels", mailboxId] as const;

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    queryKey: getLabelsQueryKey(mailboxId),
    queryFn: ({ signal }) =>
      mailboxId === DEMO_MAILBOX_ID
        ? getDemoLabels()
        : rpc.mail.listLabels({ mailboxId }, { signal }),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
