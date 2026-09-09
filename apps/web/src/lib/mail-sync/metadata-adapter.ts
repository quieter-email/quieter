import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import type { RouterOutputs } from "@quieter/orpc";
import type { SyncChange, SyncEntityData } from "@quieter/sync";
import type { QueryClient } from "@tanstack/react-query";

import { getLabelsQueryKey } from "#/lib/gmail/labels-query";
import {
  getGmailUnreadCountsQueryKey,
  getMailboxesQueryKey,
} from "#/lib/mailboxes-query";
import { getManagedLabelCountsQueryKey } from "#/lib/managed-mailbox-organization-query";
import { getSavedViewsQueryKey } from "#/lib/saved-views-query";

export const applySyncOverview = (
  queryClient: QueryClient,
  mailboxId: string,
  provider: "gmail" | "managed" | undefined,
  value: Extract<SyncEntityData, { kind: "overview" }>["value"]
) => {
  const { counts, status } = value;
  if (provider === "managed") {
    queryClient.setQueryData<RouterOutputs["mail"]["listManagedLabelCounts"]>(
      getManagedLabelCountsQueryKey(mailboxId),
      Object.entries(counts).flatMap(([key, count]) =>
        key.startsWith("label:") ? [{ count, labelId: key.slice(6) }] : []
      )
    );
  }
  const { unreadNonSpamCount } = counts;
  queryClient.setQueryData<RouterOutputs["mail"]["listMailboxes"]>(
    getMailboxesQueryKey(),
    (previous) =>
      previous === undefined
        ? undefined
        : {
            ...previous,
            groups: previous.groups.map((group) => ({
              ...group,
              mailboxes: group.mailboxes.map((mailbox) =>
                mailbox.id === mailboxId
                  ? {
                      ...mailbox,
                      connectionStatus:
                        status === "needs_reconnect"
                          ? "needs_reconnect"
                          : "connected",
                      unreadNonSpamCount:
                        unreadNonSpamCount ?? mailbox.unreadNonSpamCount,
                    }
                  : mailbox
              ),
            })),
          }
  );
  if (provider === "gmail" && unreadNonSpamCount !== undefined) {
    queryClient.setQueryData<RouterOutputs["mail"]["listGmailUnreadCounts"]>(
      getGmailUnreadCountsQueryKey(),
      (previous) => [
        ...(previous ?? []).filter((item) => item.mailboxId !== mailboxId),
        { mailboxId, unreadNonSpamCount },
      ]
    );
  }
};

export const renderSyncLabels = (
  queryClient: QueryClient,
  mailboxId: string,
  provider: "gmail" | "managed" | undefined,
  entities: Map<string, SyncChange>
) => {
  if (provider === undefined) {
    return;
  }
  const previous =
    queryClient.getQueryData<MailboxLabel[]>(getLabelsQueryKey(mailboxId)) ??
    [];
  const labels = [...entities.values()].flatMap<MailboxLabel>((entity) => {
    if (entity.data?.kind !== "label") {
      return [];
    }
    const label = entity.data.value;
    const existing = previous.find((item) => item.id === label.id);
    const color = mailboxLabelColorSchema
      .nullable()
      .safeParse(label.color ?? existing?.color);
    return [
      {
        color: color.success ? color.data : null,
        description: label.description ?? null,
        id: label.id,
        inclusionCriteria: label.inclusionCriteria ?? null,
        name: label.name,
        position: label.position ?? existing?.position ?? previous.length,
        provider,
        type: label.type === "system" ? "system" : "user",
        visible: label.visible ?? existing?.visible ?? true,
      },
    ];
  });
  queryClient.setQueryData(
    getLabelsQueryKey(mailboxId),
    labels.toSorted((left, right) => left.position - right.position)
  );
};

export const renderSyncViews = (
  queryClient: QueryClient,
  mailboxId: string,
  entities: Map<string, SyncChange>
) => {
  const views: RouterOutputs["mail"]["listSavedViews"] = [];
  for (const entity of entities.values()) {
    if (entity.data?.kind === "saved-view") {
      const { value } = entity.data;
      views.push({
        ...value,
        createdAt: new Date(value.createdAt),
        mailboxId,
        updatedAt: new Date(value.updatedAt),
      });
    }
  }
  queryClient.setQueryData(
    getSavedViewsQueryKey(mailboxId),
    views.toSorted((a, b) => a.position - b.position)
  );
};
