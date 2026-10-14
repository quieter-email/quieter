import { db } from "@quieter/database/client";
import type { MailboxSwitcherOrder } from "@quieter/database/schema";
import { user } from "@quieter/database/schema";
import { eq } from "drizzle-orm";

import type { MailboxGroup } from "./types";

export const getUserMailboxPreferences = async (userId: string) => {
  const [row] = await db
    .select({
      defaultMailboxId: user.defaultMailboxId,
      mailboxSwitcherOrder: user.mailboxSwitcherOrder,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return {
    defaultMailboxId: row?.defaultMailboxId ?? null,
    mailboxSwitcherOrder: row?.mailboxSwitcherOrder ?? null,
  };
};

export const resolveDefaultMailboxId = (
  mailboxes: { id: string }[],
  defaultMailboxId: string | null
) =>
  mailboxes.some((mailboxRecord) => mailboxRecord.id === defaultMailboxId)
    ? defaultMailboxId
    : null;

export const canonicalizeMailboxSwitcherOrder = (
  groups: {
    id: string;
    organizationId: string;
    mailboxes: { id: string; divisionId: string | null }[];
  }[],
  order: MailboxSwitcherOrder | null
): MailboxSwitcherOrder => {
  const groupIds = groups.map((group) => group.id);
  const groupIdByLegacyId = new Map<string, string>();
  for (const group of groups) {
    groupIdByLegacyId.set(group.id, group.id);
    groupIdByLegacyId.set(`team:${group.organizationId}:unassigned`, group.id);
    for (const mailbox of group.mailboxes) {
      if (mailbox.divisionId) {
        groupIdByLegacyId.set(`division:${mailbox.divisionId}`, group.id);
      }
    }
  }
  const seenGroupIds = new Set<string>();
  const orderedGroupIds = [
    ...(order?.groupIds.flatMap((groupId) => {
      const currentGroupId = groupIdByLegacyId.get(groupId);
      return currentGroupId ? [currentGroupId] : [];
    }) ?? []),
    ...groupIds,
  ].filter((groupId) => {
    if (seenGroupIds.has(groupId)) {
      return false;
    }
    seenGroupIds.add(groupId);
    return true;
  });
  const mailboxIdsByGroupId: Record<string, string[]> = {};

  for (const group of groups) {
    const mailboxIds = group.mailboxes.map((record) => record.id);
    const mailboxIdSet = new Set(mailboxIds);
    const seenMailboxIds = new Set<string>();
    const savedGroupIds = [
      ...(order?.groupIds ?? []),
      ...Object.keys(order?.mailboxIdsByGroupId ?? {}),
    ];
    mailboxIdsByGroupId[group.id] = [
      ...savedGroupIds.flatMap((groupId) =>
        groupIdByLegacyId.get(groupId) === group.id
          ? (order?.mailboxIdsByGroupId[groupId] ?? [])
          : []
      ),
      ...mailboxIds,
    ].filter((mailboxId) => {
      if (seenMailboxIds.has(mailboxId) || !mailboxIdSet.has(mailboxId)) {
        return false;
      }
      seenMailboxIds.add(mailboxId);
      return true;
    });
  }

  return { groupIds: orderedGroupIds, mailboxIdsByGroupId };
};

export const applyMailboxSwitcherOrder = (
  groups: MailboxGroup[],
  order: MailboxSwitcherOrder | null
): MailboxGroup[] => {
  if (!order) {
    return groups;
  }

  const canonicalOrder = canonicalizeMailboxSwitcherOrder(groups, order);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return canonicalOrder.groupIds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (!group) {
      return [];
    }
    const mailboxesById = new Map(
      group.mailboxes.map((record) => [record.id, record])
    );
    return [
      {
        ...group,
        mailboxes: canonicalOrder.mailboxIdsByGroupId[group.id].flatMap(
          (mailboxId) => {
            const record = mailboxesById.get(mailboxId);
            return record ? [record] : [];
          }
        ),
      },
    ];
  });
};
