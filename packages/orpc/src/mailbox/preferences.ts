import type { MailboxSwitcherOrder } from "@quieter/database/schema";
import { db } from "@quieter/database/client";
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
  mailboxes: Array<{ id: string }>,
  defaultMailboxId: string | null,
) =>
  mailboxes.some((mailboxRecord) => mailboxRecord.id === defaultMailboxId)
    ? defaultMailboxId
    : null;

export const canonicalizeMailboxSwitcherOrder = (
  groups: MailboxGroup[],
  order: MailboxSwitcherOrder | null,
): MailboxSwitcherOrder => {
  const groupIds = groups.map((group) => group.id);
  const groupIdSet = new Set(groupIds);
  const seenGroupIds = new Set<string>();
  const orderedGroupIds = [
    ...(order?.groupIds.filter((groupId) => groupIdSet.has(groupId)) ?? []),
    ...groupIds,
  ].filter((groupId) => {
    if (seenGroupIds.has(groupId) || !groupIdSet.has(groupId)) return false;
    seenGroupIds.add(groupId);
    return true;
  });
  const mailboxIdsByGroupId: Record<string, string[]> = {};

  for (const group of groups) {
    const mailboxIds = group.mailboxes.map((record) => record.id);
    const mailboxIdSet = new Set(mailboxIds);
    const seenMailboxIds = new Set<string>();
    mailboxIdsByGroupId[group.id] = [
      ...(order?.mailboxIdsByGroupId[group.id] ?? []),
      ...mailboxIds,
    ].filter((mailboxId) => {
      if (seenMailboxIds.has(mailboxId) || !mailboxIdSet.has(mailboxId)) return false;
      seenMailboxIds.add(mailboxId);
      return true;
    });
  }

  return { groupIds: orderedGroupIds, mailboxIdsByGroupId };
};

export const applyMailboxSwitcherOrder = (
  groups: MailboxGroup[],
  order: MailboxSwitcherOrder | null,
): MailboxGroup[] => {
  if (!order) return groups;

  const canonicalOrder = canonicalizeMailboxSwitcherOrder(groups, order);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return canonicalOrder.groupIds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (!group) return [];
    const mailboxesById = new Map(group.mailboxes.map((record) => [record.id, record]));
    return [
      {
        ...group,
        mailboxes: canonicalOrder.mailboxIdsByGroupId[group.id].flatMap((mailboxId) => {
          const record = mailboxesById.get(mailboxId);
          return record ? [record] : [];
        }),
      },
    ];
  });
};
