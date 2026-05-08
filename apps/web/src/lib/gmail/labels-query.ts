import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";
import { DEMO_MAILBOX_ID, getDemoLabels } from "./demo-mail";

const getLabelsQueryKey = (mailboxId: string) => ["gmail-labels", mailboxId] as const;

export const labelsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    queryKey: getLabelsQueryKey(mailboxId),
    queryFn: ({ signal }) =>
      mailboxId === DEMO_MAILBOX_ID
        ? getDemoLabels()
        : rpc.mail.listLabels({ mailboxId }, { signal }),
    enabled,
    persister: queryPersister.persisterFn,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
