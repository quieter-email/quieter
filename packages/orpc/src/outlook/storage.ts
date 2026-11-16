import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailbox,
  outlookCredential,
  outlookFolder,
  outlookMessage,
  outlookMessageFolder,
  outlookReadCursor,
  outlookSyncState,
} from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import {
  outlookFolderSchema,
  outlookSystemFoldersSchema,
} from "@quieter/outlook/graph";
import type {
  OutlookFolder,
  OutlookSystemFolders,
} from "@quieter/outlook/graph";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";
import { outlookProjectionSchema } from "./projection";
import type { OutlookProjection } from "./projection";

export type OutlookCacheScope = {
  generation: number;
  mailboxId: string;
  userId: string;
};

export type OutlookDiscoveryLease = {
  activeParentFolderId: string | null;
  checkpointVersion: number;
  cursor: string | null;
  discoveryStartedAt: Date;
  leaseId: string;
  queue: string[];
  scope: OutlookCacheScope;
  systemFolders: OutlookSystemFolders;
};

export type OutlookMessageSliceLease = {
  checkpointVersion: number;
  contentRevision: number;
  cursor: string | null;
  epoch: number;
  folderId: string;
  fullRound: boolean;
  leaseId: string;
  scope: OutlookCacheScope;
};

const LEASE_MS = 120_000;
const REFRESH_MS = 60_000;
const FOLDER_REFRESH_MS = 15 * 60_000;
const THREAD_LIMIT = 1000;
const folderQueueSchema = z.array(z.string().min(1).max(4096)).max(10_000);

const lockScope = async (
  tx: DatabaseTransaction,
  scope: OutlookCacheScope,
  mode: "read" | "write"
) => {
  const [ownedMailbox] = await tx
    .select({
      contentRevision: mailbox.contentRevision,
      status: mailbox.status,
    })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, scope.mailboxId),
        eq(mailbox.ownerUserId, scope.userId),
        eq(mailbox.provider, "outlook"),
        eq(mailbox.accessMode, "private"),
        isNull(mailbox.managedOwnerUserId),
        isNull(mailbox.divisionId)
      )
    )
    .for("update");
  if (ownedMailbox === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  const [credential] = await tx
    .select({ status: outlookCredential.status })
    .from(outlookCredential)
    .where(
      and(
        eq(outlookCredential.mailboxId, scope.mailboxId),
        eq(outlookCredential.ownerUserId, scope.userId),
        eq(outlookCredential.generation, scope.generation)
      )
    )
    .for("update");
  if (credential === undefined || credential.status === "disconnected") {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  if (
    mode === "write" &&
    (credential.status !== "connected" || ownedMailbox.status !== "connected")
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Reconnect this mailbox to continue.",
    });
  }
  return ownedMailbox;
};

const parseProjection = (value: unknown) => {
  const parsed = outlookProjectionSchema.safeParse(value);
  if (!parsed.success || JSON.stringify(parsed.data).length > 2_000_000) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The cached message could not be read.",
    });
  }
  const timestamp =
    parsed.data.message.receivedDateTime ??
    parsed.data.message.sentDateTime ??
    parsed.data.message.createdDateTime;
  if (timestamp === undefined) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The cached message could not be read.",
    });
  }
  const receivedAt = new Date(timestamp);
  const sentAt = parsed.data.message.sentDateTime
    ? new Date(parsed.data.message.sentDateTime)
    : null;
  if (
    !Number.isFinite(receivedAt.getTime()) ||
    (sentAt !== null && !Number.isFinite(sentAt.getTime()))
  ) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The cached message could not be read.",
    });
  }
  return { projection: parsed.data, receivedAt, sentAt };
};

const readProjection = (row: typeof outlookMessage.$inferSelect) => {
  const parsed = parseProjection(row.projection);
  if (
    parsed.projection.message.id !== row.messageId ||
    parsed.projection.message.conversationId !== row.threadId ||
    parsed.projection.message.changeKey !== row.changeKey ||
    parsed.projection.kind !== row.contentState ||
    parsed.projection.message.isRead !== row.isRead ||
    parsed.projection.message.isDraft !== row.isDraft ||
    parsed.receivedAt.getTime() !== row.receivedAt.getTime() ||
    parsed.sentAt?.getTime() !== row.sentAt?.getTime()
  ) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The cached message could not be read.",
    });
  }
  return parsed.projection;
};

const writeProjection = async (
  tx: DatabaseTransaction,
  scope: OutlookCacheScope,
  incoming: OutlookProjection,
  now: Date
): Promise<boolean> => {
  let { projection, receivedAt, sentAt } = parseProjection(incoming);
  const [previous] = await tx
    .select()
    .from(outlookMessage)
    .where(
      and(
        eq(outlookMessage.mailboxId, scope.mailboxId),
        eq(outlookMessage.messageId, projection.message.id)
      )
    );
  const cached = previous === undefined ? null : readProjection(previous);
  if (
    projection.kind === "metadata" &&
    previous?.deletedAt === null &&
    cached !== null
  ) {
    projection = outlookProjectionSchema.parse({
      ...projection,
      attachments: cached.attachments,
      message: {
        ...cached.message,
        ...projection.message,
        body: cached.message.body,
        internetMessageHeaders: cached.message.internetMessageHeaders,
      },
      truncation: cached.truncation,
    });
    ({ receivedAt, sentAt } = parseProjection(projection));
  }
  if (
    previous?.deletedAt === null &&
    JSON.stringify(cached) === JSON.stringify(projection)
  ) {
    return false;
  }
  const values = {
    changeKey: projection.message.changeKey,
    contentState: projection.kind,
    deletedAt: null,
    isDraft: projection.message.isDraft,
    isRead: projection.message.isRead,
    projection,
    receivedAt,
    sentAt,
    threadId: projection.message.conversationId,
    updatedAt: now,
  };
  await tx
    .insert(outlookMessage)
    .values({
      ...values,
      createdAt: now,
      mailboxId: scope.mailboxId,
      messageId: projection.message.id,
    })
    .onConflictDoUpdate({
      set: values,
      target: [outlookMessage.mailboxId, outlookMessage.messageId],
    });
  return true;
};

const advanceOutlookContentRevision = async (
  tx: DatabaseTransaction,
  scope: OutlookCacheScope,
  now: Date
): Promise<number> => {
  const [updated] = await tx
    .update(mailbox)
    .set({
      contentRevision: sql`${mailbox.contentRevision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(mailbox.id, scope.mailboxId),
        eq(mailbox.ownerUserId, scope.userId),
        eq(mailbox.provider, "outlook")
      )
    )
    .returning({ contentRevision: mailbox.contentRevision });
  if (updated === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  return updated.contentRevision;
};

export const getOutlookCachedMessage = async (
  scope: OutlookCacheScope,
  messageId: string
): Promise<OutlookProjection | null> =>
  await db.transaction(async (tx) => {
    await lockScope(tx, scope, "read");
    const [row] = await tx
      .select()
      .from(outlookMessage)
      .where(
        and(
          eq(outlookMessage.mailboxId, scope.mailboxId),
          eq(outlookMessage.messageId, messageId),
          isNull(outlookMessage.deletedAt)
        )
      );
    return row === undefined ? null : readProjection(row);
  });

export const getOutlookCachedThread = async (
  scope: OutlookCacheScope,
  threadId: string
): Promise<OutlookProjection[]> =>
  await db.transaction(async (tx) => {
    await lockScope(tx, scope, "read");
    const rows = await tx
      .select()
      .from(outlookMessage)
      .where(
        and(
          eq(outlookMessage.mailboxId, scope.mailboxId),
          eq(outlookMessage.threadId, threadId),
          isNull(outlookMessage.deletedAt),
          exists(
            tx
              .select({ messageId: outlookMessageFolder.messageId })
              .from(outlookMessageFolder)
              .where(
                and(
                  eq(outlookMessageFolder.mailboxId, scope.mailboxId),
                  eq(outlookMessageFolder.messageId, outlookMessage.messageId),
                  eq(
                    outlookMessageFolder.folderId,
                    sql`${outlookMessage.projection}->'message'->>'parentFolderId'`
                  )
                )
              )
          )
        )
      )
      .orderBy(asc(outlookMessage.receivedAt), asc(outlookMessage.messageId))
      .limit(THREAD_LIMIT + 1);
    if (rows.length > THREAD_LIMIT) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This conversation is too large to open here.",
      });
    }
    return rows.map(readProjection);
  });

export const readOutlookSyncState = async (scope: OutlookCacheScope) =>
  await db.transaction(async (tx) => {
    await lockScope(tx, scope, "read");
    const [state] = await tx
      .select()
      .from(outlookSyncState)
      .where(
        and(
          eq(outlookSyncState.mailboxId, scope.mailboxId),
          eq(outlookSyncState.generation, scope.generation)
        )
      );
    if (state === undefined) {
      return null;
    }
    const systemFolders = outlookSystemFoldersSchema.safeParse(
      state.systemFolders
    );
    const queue = folderQueueSchema.safeParse(state.folderQueue);
    if (!systemFolders.success || !queue.success) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The mailbox sync state could not be read.",
      });
    }
    return {
      discoveryCompletedAt: state.folderDiscoveryCompletedAt,
      state: state.state,
      systemFolders: systemFolders.data,
    };
  });

export const readOutlookFolders = async (scope: OutlookCacheScope) =>
  await db.transaction(async (tx) => {
    await lockScope(tx, scope, "read");
    const folders = await tx
      .select({
        displayName: outlookFolder.displayName,
        folderId: outlookFolder.folderId,
        hasPendingPage: sql<boolean>`${outlookFolder.encryptedNextLink} is not null`,
        isHidden: outlookFolder.isHidden,
        lastCompletedAt: outlookFolder.lastCompletedAt,
        parentFolderId: outlookFolder.parentFolderId,
        role: outlookFolder.role,
        state: outlookFolder.state,
        totalItemCount: outlookFolder.totalItemCount,
        unreadItemCount: outlookFolder.unreadItemCount,
      })
      .from(outlookFolder)
      .where(eq(outlookFolder.mailboxId, scope.mailboxId))
      .orderBy(asc(outlookFolder.folderId))
      .limit(10_001);
    if (folders.length > 10_000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox has too many folders to sync here.",
      });
    }
    return folders;
  });

export const claimOutlookDiscovery = async (input: {
  scope: OutlookCacheScope;
  systemFolders?: OutlookSystemFolders;
}): Promise<OutlookDiscoveryLease | null> =>
  await db.transaction(async (tx) => {
    await lockScope(tx, input.scope, "write");
    const now = new Date();
    let startedDiscovery = false;
    let [state] = await tx
      .select()
      .from(outlookSyncState)
      .where(eq(outlookSyncState.mailboxId, input.scope.mailboxId))
      .for("update");
    if (state === undefined || state.generation !== input.scope.generation) {
      startedDiscovery = true;
      const systemFolders = outlookSystemFoldersSchema.safeParse(
        input.systemFolders
      );
      if (!systemFolders.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Mailbox folders must be discovered before syncing.",
        });
      }
      await tx
        .update(outlookFolder)
        .set({
          checkpointVersion: sql`${outlookFolder.checkpointVersion} + 1`,
          encryptedDeltaLink: null,
          encryptedNextLink: null,
          leaseExpiresAt: null,
          leaseId: null,
          state: "reconcile",
          updatedAt: now,
        })
        .where(eq(outlookFolder.mailboxId, input.scope.mailboxId));
      const values = {
        activeParentFolderId: null,
        checkpointVersion: (state?.checkpointVersion ?? 0) + 1,
        discoveryStartedAt: now,
        encryptedFolderPageUrl: null,
        folderDiscoveryCompletedAt: null,
        folderQueue: [],
        generation: input.scope.generation,
        leaseExpiresAt: null,
        leaseId: null,
        state: "discovering" as const,
        systemFolders: systemFolders.data,
        updatedAt: now,
      };
      [state] = await tx
        .insert(outlookSyncState)
        .values({ ...values, createdAt: now, mailboxId: input.scope.mailboxId })
        .onConflictDoUpdate({ set: values, target: outlookSyncState.mailboxId })
        .returning();
    }
    if (state === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "Mailbox sync changed. Retry.",
      });
    }
    if (state.leaseExpiresAt !== null && state.leaseExpiresAt > now) {
      return null;
    }
    if (state.state === "ready") {
      if (
        state.folderDiscoveryCompletedAt !== null &&
        state.folderDiscoveryCompletedAt.getTime() >
          now.getTime() - FOLDER_REFRESH_MS
      ) {
        return null;
      }
      if (input.systemFolders === undefined) {
        return null;
      }
      const parsed = outlookSystemFoldersSchema.safeParse(input.systemFolders);
      startedDiscovery = true;
      if (!parsed.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Mailbox folders could not be read.",
        });
      }
      [state] = await tx
        .update(outlookSyncState)
        .set({
          activeParentFolderId: null,
          checkpointVersion: state.checkpointVersion + 1,
          discoveryStartedAt: now,
          encryptedFolderPageUrl: null,
          folderQueue: [],
          state: "discovering",
          systemFolders: parsed.data,
          updatedAt: now,
        })
        .where(
          and(
            eq(outlookSyncState.mailboxId, input.scope.mailboxId),
            eq(outlookSyncState.generation, input.scope.generation),
            eq(outlookSyncState.checkpointVersion, state.checkpointVersion)
          )
        )
        .returning();
    }
    if (startedDiscovery) {
      await advanceOutlookContentRevision(tx, input.scope, now);
    }
    if (state === undefined || state.discoveryStartedAt === null) {
      throw new ORPCError("CONFLICT", {
        message: "Mailbox sync changed. Retry.",
      });
    }
    const systemFolders = outlookSystemFoldersSchema.safeParse(
      state.systemFolders
    );
    const queue = folderQueueSchema.safeParse(state.folderQueue);
    if (!systemFolders.success || !queue.success) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The mailbox sync state could not be read.",
      });
    }
    let cursor: string | null = null;
    try {
      if (state.encryptedFolderPageUrl !== null) {
        cursor = decryptGmailCredentialSecret(state.encryptedFolderPageUrl, {
          legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
        });
      }
    } catch {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The mailbox sync state could not be read.",
      });
    }
    const leaseId = randomUUID();
    await tx
      .update(outlookSyncState)
      .set({
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        leaseId,
        updatedAt: now,
      })
      .where(
        and(
          eq(outlookSyncState.mailboxId, input.scope.mailboxId),
          eq(outlookSyncState.generation, input.scope.generation),
          eq(outlookSyncState.checkpointVersion, state.checkpointVersion),
          or(
            isNull(outlookSyncState.leaseExpiresAt),
            lte(outlookSyncState.leaseExpiresAt, now)
          )
        )
      );
    return {
      activeParentFolderId: state.activeParentFolderId,
      checkpointVersion: state.checkpointVersion,
      cursor,
      discoveryStartedAt: state.discoveryStartedAt,
      leaseId,
      queue: queue.data,
      scope: input.scope,
      systemFolders: systemFolders.data,
    };
  });

export const commitOutlookDiscovery = async (input: {
  lease: OutlookDiscoveryLease;
  page: { nextPageUrl?: string; values: OutlookFolder[] };
}) => {
  const parsed = z
    .array(
      outlookFolderSchema.extend({
        childFolderCount: z.number().int().nonnegative(),
        totalItemCount: z.number().int().nonnegative(),
        unreadItemCount: z.number().int().nonnegative(),
      })
    )
    .max(1000)
    .safeParse(input.page.values);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Mailbox folders could not be read.",
    });
  }
  await db.transaction(async (tx) => {
    const { lease } = input;
    await lockScope(tx, lease.scope, "write");
    const now = new Date();
    const [state] = await tx
      .select()
      .from(outlookSyncState)
      .where(
        and(
          eq(outlookSyncState.mailboxId, lease.scope.mailboxId),
          eq(outlookSyncState.generation, lease.scope.generation),
          eq(outlookSyncState.checkpointVersion, lease.checkpointVersion),
          eq(outlookSyncState.leaseId, lease.leaseId),
          gt(outlookSyncState.leaseExpiresAt, now),
          eq(outlookSyncState.state, "discovering")
        )
      )
      .for("update");
    if (state === undefined || state.discoveryStartedAt === null) {
      throw new ORPCError("CONFLICT", {
        message: "Mailbox sync changed. Retry.",
      });
    }
    const roles = outlookSystemFoldersSchema.safeParse(state.systemFolders);
    const persistedQueue = folderQueueSchema.safeParse(state.folderQueue);
    if (!roles.success || !persistedQueue.success) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The mailbox sync state could not be read.",
      });
    }
    const queue = new Set(persistedQueue.data);
    let changed = false;
    const roleById = new Map<string, typeof outlookFolder.$inferSelect.role>();
    for (const role of outlookSystemFoldersSchema.keyof().options) {
      roleById.set(roles.data[role], role);
    }
    for (const folder of parsed.data) {
      if (folder.id === state.activeParentFolderId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Mailbox folders could not be read.",
        });
      }
      if (
        state.activeParentFolderId !== null &&
        folder.parentFolderId !== undefined &&
        folder.parentFolderId !== state.activeParentFolderId
      ) {
        throw new ORPCError("CONFLICT", {
          message: "Mailbox folders changed. Retry.",
        });
      }
      const [previous] = await tx
        .select()
        .from(outlookFolder)
        .where(
          and(
            eq(outlookFolder.mailboxId, lease.scope.mailboxId),
            eq(outlookFolder.folderId, folder.id)
          )
        );
      const metadata = {
        displayName: folder.displayName,
        isHidden: folder.isHidden ?? false,
        lastDiscoveredAt: state.discoveryStartedAt,
        parentFolderId: folder.parentFolderId ?? state.activeParentFolderId,
        role: roleById.get(folder.id) ?? null,
        totalItemCount: folder.totalItemCount,
        unreadItemCount: folder.unreadItemCount,
        updatedAt: now,
      };
      changed ||=
        previous === undefined ||
        previous.displayName !== metadata.displayName ||
        previous.isHidden !== metadata.isHidden ||
        previous.parentFolderId !== metadata.parentFolderId ||
        previous.role !== metadata.role ||
        previous.totalItemCount !== metadata.totalItemCount ||
        previous.unreadItemCount !== metadata.unreadItemCount;
      await tx
        .insert(outlookFolder)
        .values({
          ...metadata,
          createdAt: now,
          folderId: folder.id,
          mailboxId: lease.scope.mailboxId,
        })
        .onConflictDoUpdate({
          set: metadata,
          target: [outlookFolder.mailboxId, outlookFolder.folderId],
        });
      if (
        folder.childFolderCount > 0 &&
        previous?.lastDiscoveredAt?.getTime() !==
          state.discoveryStartedAt.getTime()
      ) {
        queue.add(folder.id);
      }
    }
    if (queue.size > 10_000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox has too many folders to sync here.",
      });
    }
    const remaining = [...queue];
    const activeParentFolderId = input.page.nextPageUrl
      ? state.activeParentFolderId
      : (remaining.shift() ?? null);
    const complete = !input.page.nextPageUrl && activeParentFolderId === null;
    if (complete) {
      changed = true;
      const required = await tx
        .select({ folderId: outlookFolder.folderId })
        .from(outlookFolder)
        .where(
          and(
            eq(outlookFolder.mailboxId, lease.scope.mailboxId),
            eq(outlookFolder.lastDiscoveredAt, state.discoveryStartedAt),
            inArray(outlookFolder.folderId, Object.values(roles.data))
          )
        );
      if (
        new Set(required.map((folder) => folder.folderId)).size !==
        new Set(Object.values(roles.data)).size
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Mailbox folders could not be read.",
        });
      }
      const removed = await tx
        .delete(outlookFolder)
        .where(
          and(
            eq(outlookFolder.mailboxId, lease.scope.mailboxId),
            or(
              isNull(outlookFolder.lastDiscoveredAt),
              lt(outlookFolder.lastDiscoveredAt, state.discoveryStartedAt)
            )
          )
        )
        .returning({ folderId: outlookFolder.folderId });
      changed ||= removed.length > 0;
    }
    await tx
      .update(outlookSyncState)
      .set({
        activeParentFolderId,
        checkpointVersion: state.checkpointVersion + 1,
        encryptedFolderPageUrl: input.page.nextPageUrl
          ? encryptGmailCredentialSecret(input.page.nextPageUrl, {
              legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
            })
          : null,
        folderDiscoveryCompletedAt: complete
          ? now
          : state.folderDiscoveryCompletedAt,
        folderQueue: remaining,
        leaseExpiresAt: null,
        leaseId: null,
        state: complete ? "ready" : "discovering",
        updatedAt: now,
      })
      .where(
        and(
          eq(outlookSyncState.mailboxId, lease.scope.mailboxId),
          eq(outlookSyncState.generation, lease.scope.generation),
          eq(outlookSyncState.checkpointVersion, lease.checkpointVersion),
          eq(outlookSyncState.leaseId, lease.leaseId)
        )
      );
    if (changed) {
      await advanceOutlookContentRevision(tx, lease.scope, now);
    }
  });
};

export const claimOutlookMessageSlice = async (input: {
  scope: OutlookCacheScope;
}): Promise<OutlookMessageSliceLease | null> =>
  await db.transaction(async (tx) => {
    const ownedMailbox = await lockScope(tx, input.scope, "write");
    const [syncState] = await tx
      .select({ generation: outlookSyncState.generation })
      .from(outlookSyncState)
      .where(
        and(
          eq(outlookSyncState.mailboxId, input.scope.mailboxId),
          eq(outlookSyncState.generation, input.scope.generation)
        )
      )
      .for("update");
    if (syncState === undefined) {
      return null;
    }
    const now = new Date();
    const [folder] = await tx
      .select()
      .from(outlookFolder)
      .where(
        and(
          eq(outlookFolder.mailboxId, input.scope.mailboxId),
          or(
            isNull(outlookFolder.leaseExpiresAt),
            lte(outlookFolder.leaseExpiresAt, now)
          ),
          or(
            inArray(outlookFolder.state, ["pending", "hydrating", "reconcile"]),
            and(
              eq(outlookFolder.state, "ready"),
              or(
                sql`${outlookFolder.encryptedNextLink} is not null`,
                isNull(outlookFolder.lastCompletedAt),
                lte(
                  outlookFolder.lastCompletedAt,
                  new Date(now.getTime() - REFRESH_MS)
                )
              )
            )
          )
        )
      )
      .orderBy(
        sql`case when ${outlookFolder.role} = 'inbox' and ${outlookFolder.state} <> 'ready' then 0 when ${outlookFolder.state} <> 'ready' then 1 else 2 end`,
        asc(outlookFolder.updatedAt),
        asc(outlookFolder.folderId)
      )
      .limit(1)
      .for("update");
    if (folder === undefined) {
      return null;
    }
    const fullRound =
      folder.state !== "ready" || folder.encryptedDeltaLink === null;
    const epoch =
      folder.syncEpoch +
      (fullRound && folder.encryptedNextLink === null ? 1 : 0);
    const encryptedCursor =
      folder.encryptedNextLink ??
      (fullRound ? null : folder.encryptedDeltaLink);
    let cursor: string | null = null;
    try {
      if (encryptedCursor !== null) {
        cursor = decryptGmailCredentialSecret(encryptedCursor, {
          legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
        });
      }
    } catch {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The mailbox sync state could not be read.",
      });
    }
    const leaseId = randomUUID();
    await tx
      .update(outlookFolder)
      .set({
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        leaseId,
        state: fullRound ? "hydrating" : "ready",
        syncEpoch: epoch,
        updatedAt: now,
      })
      .where(
        and(
          eq(outlookFolder.mailboxId, input.scope.mailboxId),
          eq(outlookFolder.folderId, folder.folderId),
          eq(outlookFolder.checkpointVersion, folder.checkpointVersion)
        )
      );
    return {
      checkpointVersion: folder.checkpointVersion,
      contentRevision: ownedMailbox.contentRevision,
      cursor,
      epoch,
      folderId: folder.folderId,
      fullRound,
      leaseId,
      scope: input.scope,
    };
  });

export const commitOutlookMessagePage = async (input: {
  changes: (
    | { kind: "message"; projection: OutlookProjection }
    | { kind: "removed"; messageId: string }
  )[];
  continuation: { kind: "delta" | "next"; url: string };
  lease: OutlookMessageSliceLease;
}) => {
  if (input.changes.length > 1000 || !input.continuation.url) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Mailbox messages could not be read.",
    });
  }
  const changes = input.changes.map((change) => {
    if (change.kind === "removed") {
      if (change.messageId.length === 0 || change.messageId.length > 4096) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Mailbox messages could not be read.",
        });
      }
      return change;
    }
    const { projection } = parseProjection(change.projection);
    if (projection.message.parentFolderId !== input.lease.folderId) {
      throw new ORPCError("CONFLICT", {
        message: "Mailbox messages changed. Retry.",
      });
    }
    return { kind: "message" as const, projection };
  });
  const encryptedCursor = encryptGmailCredentialSecret(input.continuation.url, {
    legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
  });
  await db.transaction(async (tx) => {
    const { lease } = input;
    const ownedMailbox = await lockScope(tx, lease.scope, "write");
    if (ownedMailbox.contentRevision !== lease.contentRevision) {
      throw new ORPCError("CONFLICT", {
        message: "Mailbox messages changed. Retry.",
      });
    }
    const now = new Date();
    const [folder] = await tx
      .select()
      .from(outlookFolder)
      .where(
        and(
          eq(outlookFolder.mailboxId, lease.scope.mailboxId),
          eq(outlookFolder.folderId, lease.folderId),
          eq(outlookFolder.checkpointVersion, lease.checkpointVersion),
          eq(outlookFolder.leaseId, lease.leaseId),
          eq(outlookFolder.syncEpoch, lease.epoch),
          eq(outlookFolder.state, lease.fullRound ? "hydrating" : "ready"),
          gt(outlookFolder.leaseExpiresAt, now)
        )
      )
      .for("update");
    if (folder === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "Mailbox sync changed. Retry.",
      });
    }
    const wasCovered =
      folder.state === "ready" &&
      folder.lastCompletedAt !== null &&
      folder.encryptedNextLink === null;
    let changed = wasCovered !== (input.continuation.kind === "delta");
    for (const change of changes) {
      if (change.kind === "removed") {
        const removed = await tx
          .delete(outlookMessageFolder)
          .where(
            and(
              eq(outlookMessageFolder.mailboxId, lease.scope.mailboxId),
              eq(outlookMessageFolder.folderId, lease.folderId),
              eq(outlookMessageFolder.messageId, change.messageId)
            )
          )
          .returning({ messageId: outlookMessageFolder.messageId });
        changed ||= removed.length > 0;
      } else {
        const projectionChanged = await writeProjection(
          tx,
          lease.scope,
          change.projection,
          now
        );
        const [membership] = await tx
          .select({ messageId: outlookMessageFolder.messageId })
          .from(outlookMessageFolder)
          .where(
            and(
              eq(outlookMessageFolder.mailboxId, lease.scope.mailboxId),
              eq(outlookMessageFolder.folderId, lease.folderId),
              eq(outlookMessageFolder.messageId, change.projection.message.id)
            )
          );
        changed ||= projectionChanged || membership === undefined;
        await tx
          .insert(outlookMessageFolder)
          .values({
            createdAt: now,
            folderId: lease.folderId,
            mailboxId: lease.scope.mailboxId,
            messageId: change.projection.message.id,
            seenEpoch: lease.epoch,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: { seenEpoch: lease.epoch, updatedAt: now },
            target: [
              outlookMessageFolder.mailboxId,
              outlookMessageFolder.folderId,
              outlookMessageFolder.messageId,
            ],
          });
      }
    }
    if (input.continuation.kind === "delta" && lease.fullRound) {
      const removed = await tx
        .delete(outlookMessageFolder)
        .where(
          and(
            eq(outlookMessageFolder.mailboxId, lease.scope.mailboxId),
            eq(outlookMessageFolder.folderId, lease.folderId),
            lt(outlookMessageFolder.seenEpoch, lease.epoch)
          )
        )
        .returning({ messageId: outlookMessageFolder.messageId });
      changed ||= removed.length > 0;
    }
    await tx
      .update(outlookFolder)
      .set({
        checkpointVersion: folder.checkpointVersion + 1,
        encryptedDeltaLink:
          input.continuation.kind === "delta"
            ? encryptedCursor
            : folder.encryptedDeltaLink,
        encryptedNextLink:
          input.continuation.kind === "next" ? encryptedCursor : null,
        lastCompletedAt:
          input.continuation.kind === "delta" ? now : folder.lastCompletedAt,
        lastErrorCode: null,
        leaseExpiresAt: null,
        leaseId: null,
        state:
          input.continuation.kind === "delta" || !lease.fullRound
            ? "ready"
            : "hydrating",
        updatedAt: now,
      })
      .where(
        and(
          eq(outlookFolder.mailboxId, lease.scope.mailboxId),
          eq(outlookFolder.folderId, lease.folderId),
          eq(outlookFolder.checkpointVersion, lease.checkpointVersion),
          eq(outlookFolder.leaseId, lease.leaseId)
        )
      );
    if (changed) {
      await advanceOutlookContentRevision(tx, lease.scope, now);
    }
  });
};

export const releaseOutlookDiscovery = async (input: {
  lease: OutlookDiscoveryLease;
  resetCursor?: boolean;
}) => {
  await db.transaction(async (tx) => {
    const { lease } = input;
    await lockScope(tx, lease.scope, "write");
    const now = new Date();
    await tx
      .update(outlookSyncState)
      .set({
        ...(input.resetCursor === true
          ? {
              activeParentFolderId: null,
              checkpointVersion: sql`${outlookSyncState.checkpointVersion} + 1`,
              discoveryStartedAt: now,
              encryptedFolderPageUrl: null,
              folderQueue: [],
              state: "discovering" as const,
            }
          : {}),
        leaseExpiresAt: null,
        leaseId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(outlookSyncState.mailboxId, lease.scope.mailboxId),
          eq(outlookSyncState.generation, lease.scope.generation),
          eq(outlookSyncState.checkpointVersion, lease.checkpointVersion),
          eq(outlookSyncState.leaseId, lease.leaseId)
        )
      );
  });
};

export const releaseOutlookMessageSlice = async (input: {
  lease: OutlookMessageSliceLease;
  resetCursor?: boolean;
}) => {
  await db.transaction(async (tx) => {
    const { lease } = input;
    await lockScope(tx, lease.scope, "write");
    await tx
      .update(outlookFolder)
      .set({
        ...(input.resetCursor === true
          ? {
              checkpointVersion: sql`${outlookFolder.checkpointVersion} + 1`,
              encryptedDeltaLink: null,
              encryptedNextLink: null,
              state: "reconcile" as const,
            }
          : {}),
        lastErrorCode:
          input.resetCursor === true ? "invalid_cursor" : "temporary",
        leaseExpiresAt: null,
        leaseId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outlookFolder.mailboxId, lease.scope.mailboxId),
          eq(outlookFolder.folderId, lease.folderId),
          eq(outlookFolder.checkpointVersion, lease.checkpointVersion),
          eq(outlookFolder.leaseId, lease.leaseId),
          eq(outlookFolder.syncEpoch, lease.epoch)
        )
      );
  });
};

export const reconcileOutlookThreadMembership = async (input: {
  expectedContentRevision: number;
  messageIds: string[];
  scope: OutlookCacheScope;
  threadId: string;
}): Promise<boolean> =>
  await db.transaction(async (tx) => {
    const owned = await lockScope(tx, input.scope, "write");
    if (owned.contentRevision !== input.expectedContentRevision) {
      return false;
    }
    const removed = await tx
      .delete(outlookMessageFolder)
      .where(
        and(
          eq(outlookMessageFolder.mailboxId, input.scope.mailboxId),
          input.messageIds.length > 0
            ? notInArray(outlookMessageFolder.messageId, input.messageIds)
            : undefined,
          exists(
            tx
              .select({ messageId: outlookMessage.messageId })
              .from(outlookMessage)
              .where(
                and(
                  eq(outlookMessage.mailboxId, input.scope.mailboxId),
                  eq(outlookMessage.threadId, input.threadId),
                  eq(outlookMessage.messageId, outlookMessageFolder.messageId)
                )
              )
          )
        )
      )
      .returning({ messageId: outlookMessageFolder.messageId });
    if (removed.length > 0) {
      await advanceOutlookContentRevision(tx, input.scope, new Date());
    }
    return true;
  });

export const readOutlookCacheRevision = async (scope: OutlookCacheScope) =>
  await db.transaction(async (tx) => {
    const owned = await lockScope(tx, scope, "read");
    return owned.contentRevision;
  });

export type OutlookCacheWriteResult =
  | { cached: false }
  | { cached: true; contentRevision: number };

export const cacheOutlookMessage = async (input: {
  expectedContentRevision: number;
  expectedChangeKey: string | null;
  projection: OutlookProjection;
  scope: OutlookCacheScope;
}): Promise<OutlookCacheWriteResult> => {
  const { projection } = parseProjection(input.projection);
  return await db.transaction(async (tx): Promise<OutlookCacheWriteResult> => {
    const owned = await lockScope(tx, input.scope, "write");
    if (owned.contentRevision !== input.expectedContentRevision) {
      return { cached: false };
    }
    const [previous] = await tx
      .select({ changeKey: outlookMessage.changeKey })
      .from(outlookMessage)
      .where(
        and(
          eq(outlookMessage.mailboxId, input.scope.mailboxId),
          eq(outlookMessage.messageId, projection.message.id)
        )
      )
      .for("update");
    if ((previous?.changeKey ?? null) !== input.expectedChangeKey) {
      return { cached: false };
    }
    const now = new Date();
    let changed = await writeProjection(tx, input.scope, projection, now);
    const [folder] = await tx
      .select({ epoch: outlookFolder.syncEpoch })
      .from(outlookFolder)
      .where(
        and(
          eq(outlookFolder.mailboxId, input.scope.mailboxId),
          eq(outlookFolder.folderId, projection.message.parentFolderId)
        )
      )
      .for("update");
    if (folder !== undefined) {
      const [membership] = await tx
        .select({ messageId: outlookMessageFolder.messageId })
        .from(outlookMessageFolder)
        .where(
          and(
            eq(outlookMessageFolder.mailboxId, input.scope.mailboxId),
            eq(
              outlookMessageFolder.folderId,
              projection.message.parentFolderId
            ),
            eq(outlookMessageFolder.messageId, projection.message.id)
          )
        );
      changed ||= membership === undefined;
      await tx
        .insert(outlookMessageFolder)
        .values({
          createdAt: now,
          folderId: projection.message.parentFolderId,
          mailboxId: input.scope.mailboxId,
          messageId: projection.message.id,
          seenEpoch: folder.epoch,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: { seenEpoch: folder.epoch, updatedAt: now },
          target: [
            outlookMessageFolder.mailboxId,
            outlookMessageFolder.folderId,
            outlookMessageFolder.messageId,
          ],
        });
    }
    const removed = await tx
      .delete(outlookMessageFolder)
      .where(
        and(
          eq(outlookMessageFolder.mailboxId, input.scope.mailboxId),
          eq(outlookMessageFolder.messageId, projection.message.id),
          ne(outlookMessageFolder.folderId, projection.message.parentFolderId)
        )
      )
      .returning({ messageId: outlookMessageFolder.messageId });
    changed ||= removed.length > 0;
    const contentRevision = changed
      ? await advanceOutlookContentRevision(tx, input.scope, now)
      : owned.contentRevision;
    return { cached: true, contentRevision };
  });
};

export const createOutlookReadCursor = async (input: {
  expiresAt: Date;
  queryHash: string;
  scope: OutlookCacheScope;
  state: unknown;
}): Promise<string> => {
  const now = new Date();
  if (
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt <= now ||
    input.expiresAt.getTime() > now.getTime() + 60 * 60_000
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page expired. Refresh to continue.",
    });
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input.state);
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page could not be saved.",
    });
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf-8") > 512 * 1024 ||
    !input.queryHash
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page could not be saved.",
    });
  }
  const id = randomUUID();
  const encryptedState = encryptGmailCredentialSecret(serialized, {
    legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
  });
  await db.transaction(async (tx) => {
    await lockScope(tx, input.scope, "write");
    await tx
      .delete(outlookReadCursor)
      .where(
        and(
          eq(outlookReadCursor.mailboxId, input.scope.mailboxId),
          lte(outlookReadCursor.expiresAt, now)
        )
      );
    const oldCursors = await tx
      .select({ id: outlookReadCursor.id })
      .from(outlookReadCursor)
      .where(eq(outlookReadCursor.mailboxId, input.scope.mailboxId))
      .orderBy(desc(outlookReadCursor.createdAt), desc(outlookReadCursor.id))
      .offset(19);
    if (oldCursors.length > 0) {
      await tx.delete(outlookReadCursor).where(
        and(
          eq(outlookReadCursor.mailboxId, input.scope.mailboxId),
          inArray(
            outlookReadCursor.id,
            oldCursors.map((cursor) => cursor.id)
          )
        )
      );
    }
    await tx.insert(outlookReadCursor).values({
      createdAt: now,
      credentialGeneration: input.scope.generation,
      encryptedState,
      expiresAt: input.expiresAt,
      id,
      mailboxId: input.scope.mailboxId,
      ownerUserId: input.scope.userId,
      queryHash: input.queryHash,
    });
  });
  return id;
};

export const readOutlookReadCursor = async (input: {
  id: string;
  queryHash: string;
  scope: OutlookCacheScope;
}): Promise<unknown> =>
  await db.transaction(async (tx) => {
    await lockScope(tx, input.scope, "read");
    const [cursor] = await tx
      .select({ encryptedState: outlookReadCursor.encryptedState })
      .from(outlookReadCursor)
      .where(
        and(
          eq(outlookReadCursor.id, input.id),
          eq(outlookReadCursor.mailboxId, input.scope.mailboxId),
          eq(outlookReadCursor.ownerUserId, input.scope.userId),
          eq(outlookReadCursor.credentialGeneration, input.scope.generation),
          eq(outlookReadCursor.queryHash, input.queryHash),
          gt(outlookReadCursor.expiresAt, new Date())
        )
      );
    if (cursor === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The message page expired. Refresh to continue.",
      });
    }
    try {
      const state: unknown = JSON.parse(
        decryptGmailCredentialSecret(cursor.encryptedState, {
          legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
        })
      );
      return state;
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "The message page expired. Refresh to continue.",
      });
    }
  });
