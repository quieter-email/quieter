import type { RouterOutputs } from "@quieter/orpc";
import type { SyncChange } from "@quieter/sync";
import type { QueryClient } from "@tanstack/react-query";

export const applyDeliveryChange = (
  queryClient: QueryClient,
  mailboxId: string,
  entity: SyncChange
) => {
  if (entity.kind !== "delivery") {
    return;
  }
  const delivery = entity.data?.kind === "delivery" ? entity.data.value : null;
  queryClient.setQueriesData<
    RouterOutputs["mail"]["listMessageDeliveryStatuses"]
  >({ queryKey: ["message-delivery-list", mailboxId] }, (previous) =>
    previous === undefined
      ? undefined
      : {
          ...previous,
          [entity.id]:
            delivery?.recipients.map((recipient) => recipient.status) ?? [],
        }
  );
  const queryKey = ["message-delivery", mailboxId, entity.id];
  if (delivery === null) {
    queryClient.removeQueries({ queryKey });
    return;
  }
  queryClient.setQueryData<RouterOutputs["mail"]["getMessageDelivery"]>(
    queryKey,
    (previous) =>
      previous === undefined || previous === null
        ? previous
        : {
            ...previous,
            recipients: delivery.recipients.map((recipient) => ({
              ...recipient,
              lastEventAt: new Date(recipient.lastEventAt),
            })),
          }
  );
  void queryClient.invalidateQueries({ queryKey });
};
