import { db } from "@quieter/database/client";
import {
  mailbox,
  member,
  outlookCredential,
  outlookFolder,
  outlookMessage,
  outlookMessageFolder,
  outlookSyncState,
} from "@quieter/database/schema";
import {
  and,
  asc,
  countDistinct,
  eq,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";

export const listOwnedOutlookMailboxState = async (userId: string) => {
  const unreadCounts = db
    .select({
      count: countDistinct(outlookMessage.threadId).as("unreadCount"),
      mailboxId: outlookMessage.mailboxId,
    })
    .from(outlookMessage)
    .innerJoin(
      outlookMessageFolder,
      and(
        eq(outlookMessageFolder.mailboxId, outlookMessage.mailboxId),
        eq(outlookMessageFolder.messageId, outlookMessage.messageId),
        sql`${outlookMessage.projection}->'message'->>'parentFolderId' = ${outlookMessageFolder.folderId}`
      )
    )
    .innerJoin(
      outlookFolder,
      and(
        eq(outlookFolder.mailboxId, outlookMessageFolder.mailboxId),
        eq(outlookFolder.folderId, outlookMessageFolder.folderId)
      )
    )
    .where(
      and(
        eq(outlookMessage.isRead, false),
        isNull(outlookMessage.deletedAt),
        sql`(${outlookFolder.role} is null or ${notInArray(outlookFolder.role, ["spam", "trash"])})`
      )
    )
    .groupBy(outlookMessage.mailboxId)
    .as("outlookUnreadCounts");
  const rows = await db
    .select({
      credentialStatus: outlookCredential.status,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.ownerUserId,
      signatureHtml: mailbox.signatureHtml,
      signatureText: mailbox.signatureText,
      status: mailbox.status,
      unreadCoverageComplete: sql<boolean>`coalesce(
        ${outlookSyncState.state} = 'ready' and ${outlookSyncState.folderDiscoveryCompletedAt} is not null
        and not exists (select 1 from ${outlookFolder} f where f."mailboxId" = ${mailbox.id}
          and (f.state <> 'ready' or f."lastCompletedAt" is null or f."encryptedNextLink" is not null)), false)`,
      unreadNonSpamCount: sql<number>`case when ${mailbox.status} = 'connected'
        and ${outlookCredential.status} = 'connected' and ${outlookSyncState.mailboxId} is not null
        then coalesce(${unreadCounts.count}, 0) else 0 end`.mapWith(Number),
    })
    .from(mailbox)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, mailbox.organizationId),
        eq(member.userId, userId)
      )
    )
    .leftJoin(
      outlookCredential,
      and(
        eq(outlookCredential.mailboxId, mailbox.id),
        eq(outlookCredential.ownerUserId, userId)
      )
    )
    .leftJoin(
      outlookSyncState,
      and(
        eq(outlookSyncState.mailboxId, mailbox.id),
        eq(outlookSyncState.generation, outlookCredential.generation)
      )
    )
    .leftJoin(unreadCounts, eq(unreadCounts.mailboxId, mailbox.id))
    .where(
      and(
        eq(mailbox.provider, "outlook"),
        eq(mailbox.ownerUserId, userId),
        eq(mailbox.accessMode, "private"),
        isNull(mailbox.managedOwnerUserId),
        isNull(mailbox.divisionId)
      )
    )
    .orderBy(asc(mailbox.emailAddress));
  return rows.map((row) => ({
    ...row,
    grantRole: null,
    provider: "outlook" as const,
    status:
      row.status === "connected" && row.credentialStatus === "connected"
        ? ("connected" as const)
        : ("needs_reconnect" as const),
    unreadCountCoverage: {
      complete:
        row.status === "connected" &&
        row.credentialStatus === "connected" &&
        row.unreadCoverageComplete,
      scope: "mailbox" as const,
    },
  }));
};

export const getOwnedOutlookMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const [owned] = await db
    .select({
      contentRevision: mailbox.contentRevision,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
    })
    .from(mailbox)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, mailbox.organizationId),
        eq(member.userId, input.userId)
      )
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.provider, "outlook"),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.accessMode, "private"),
        isNull(mailbox.managedOwnerUserId),
        isNull(mailbox.divisionId)
      )
    )
    .limit(1);
  return owned === undefined
    ? null
    : { ...owned, provider: "outlook" as const };
};
