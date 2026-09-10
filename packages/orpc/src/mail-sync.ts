import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  gmailCredential,
  mailSyncEntity,
  mailSyncCommand,
  mailSyncProviderState,
  mailSyncStream,
  session,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import type { SyncCheckpoint } from "@quieter/sync";
import { visibleSyncChanges } from "@quieter/sync";
import { createSyncTicket } from "@quieter/sync-server/auth";
import {
  prepareSyncMessage,
  readSyncBody,
} from "@quieter/sync-server/body-store";
import {
  hydrateGmailThreads,
  gmailSyncProvider,
  synchronizeGmail,
} from "@quieter/sync-server/gmail";
import {
  bootstrapManagedMailbox,
  projectManagedMailbox,
} from "@quieter/sync-server/managed";
import { and, asc, eq, isNull, isNotNull, lte, or, sql } from "drizzle-orm";

import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";
import { mailSyncCommandService } from "./mail-sync-commands";
import {
  getMailSyncConfiguration,
  mailSyncServices,
} from "./mail-sync-runtime";
import { recoverGmailSubmissions } from "./mail-sync-submissions";
import { assertAccessibleMailbox } from "./mailbox/service";
import { getManagedThread } from "./managed-mail/messages/service";

export {
  getMailSyncConfiguration,
  mailSyncServices,
  withMailSyncRuntime,
} from "./mail-sync-runtime";
export const authorizeSyncMailbox = async (mailboxId: string, userId: string) =>
  await assertAccessibleMailbox({ mailboxId, userId });

export const authorizeSyncSession = async (
  sessionId: string,
  userId: string
) => {
  const [active] = await db
    .select({ expiresAt: session.expiresAt })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)));
  if (active === undefined || active.expiresAt.getTime() <= Date.now()) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  }
};

export const runMailboxSynchronization = async (mailboxId: string) => {
  const [selected] = await db
    .select()
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId));
  if (selected === undefined || selected.status !== "connected") {
    return { hasMore: false };
  }
  const { bodies, repository } = mailSyncServices();
  const processedCommand = await mailSyncCommandService().process(mailboxId);
  if (selected.provider === "managed") {
    const result = await bootstrapManagedMailbox(repository, bodies, mailboxId);
    return { hasMore: processedCommand || result.hasMore };
  }
  if (!selected.ownerUserId) {
    throw new Error("Mailbox ownership is missing.");
  }
  try {
    return await runAuthorizedGmailMailbox(
      { mailboxId, userId: selected.ownerUserId },
      async (token) => {
        const result = await synchronizeGmail(
          repository,
          bodies,
          mailboxId,
          gmailSyncProvider(token, AbortSignal.timeout(45_000))
        );
        if (!result.hasMore) {
          try {
            await recoverGmailSubmissions(mailboxId, token);
          } catch (error) {
            reportError(error, { operation: "mail_sync_submission_recovery" });
          }
        }
        return { hasMore: processedCommand || result.hasMore };
      }
    );
  } catch (error) {
    if (
      error instanceof ORPCError &&
      [
        "NOT_FOUND",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "MAILBOX_SCOPE_REPAIR_REQUIRED",
      ].includes(String(error.code))
    ) {
      return { hasMore: false };
    }
    throw error;
  }
};

export const maintainMailSynchronization = async () => {
  const { repository, enqueue } = mailSyncServices();
  await repository.recoverOutbox();
  const pendingCommands = await db
    .selectDistinct({ mailboxId: mailSyncCommand.mailboxId })
    .from(mailSyncCommand)
    .where(
      and(
        or(
          eq(mailSyncCommand.status, "accepted"),
          eq(mailSyncCommand.status, "running")
        ),
        lte(mailSyncCommand.nextAttemptAt, new Date())
      )
    )
    .limit(50);
  for (const command of pendingCommands) {
    await enqueue(command.mailboxId);
  }
  const due = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .leftJoin(mailSyncStream, eq(mailSyncStream.mailboxId, mailbox.id))
    .leftJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
    .leftJoin(
      mailSyncProviderState,
      eq(mailSyncProviderState.mailboxId, mailbox.id)
    )
    .where(
      and(
        eq(mailbox.status, "connected"),
        or(
          eq(mailbox.provider, "managed"),
          isNotNull(gmailCredential.mailboxId)
        ),
        or(
          isNull(mailSyncStream.mailboxId),
          and(
            eq(mailbox.provider, "gmail"),
            or(
              isNull(mailSyncProviderState.mailboxId),
              lte(mailSyncProviderState.nextAttemptAt, new Date())
            )
          )
        )
      )
    )
    .orderBy(
      asc(
        sql`coalesce(${mailSyncProviderState.lastSyncedAt}, '1970-01-01'::timestamptz)`
      ),
      asc(mailbox.id)
    )
    .limit(50);
  for (const selected of due) {
    await enqueue(selected.id);
  }
  const oldest = await db
    .select({ mailboxId: mailSyncStream.mailboxId })
    .from(mailSyncStream)
    .orderBy(asc(mailSyncStream.updatedAt))
    .limit(50);
  for (const stream of oldest) {
    await repository.prune(stream.mailboxId);
  }
};

export const mailSyncOperations = {
  body: async (input: {
    mailboxId: string;
    userId: string;
    messageId: string;
    hash: string;
  }) => {
    await authorizeSyncMailbox(input.mailboxId, input.userId);
    const [entity] = await db
      .select()
      .from(mailSyncEntity)
      .where(
        and(
          eq(mailSyncEntity.mailboxId, input.mailboxId),
          eq(mailSyncEntity.kind, "message"),
          eq(mailSyncEntity.entityId, input.messageId)
        )
      );
    if (
      entity?.data?.kind !== "message" ||
      entity.data.value.body?.hash !== input.hash
    ) {
      throw new ORPCError("NOT_FOUND", {
        message: "Message content is no longer available.",
      });
    }
    const { bodies } = mailSyncServices();
    let body = await readSyncBody(bodies, input.mailboxId, input.hash);
    if (body === null) {
      await mailSyncOperations.hydrate({
        ...input,
        threadIds: [entity.data.value.threadId],
      });
      body = await readSyncBody(bodies, input.mailboxId, input.hash);
    }
    if (body === null) {
      throw new ORPCError("NOT_FOUND", {
        message: "Message content is no longer available.",
      });
    }
    return body;
  },
  connection: (userId: string, sessionId: string) => {
    const configuration = getMailSyncConfiguration();
    const url = new URL("/connect", configuration.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(
      "ticket",
      createSyncTicket(userId, sessionId, configuration.secret)
    );
    return { url: url.toString() };
  },
  hydrate: async (input: {
    mailboxId: string;
    userId: string;
    threadIds: string[];
  }) => {
    const selected = await authorizeSyncMailbox(input.mailboxId, input.userId);
    const { bodies, repository } = mailSyncServices();
    if (selected.provider === "managed") {
      for (const threadId of input.threadIds) {
        const thread = await getManagedThread({
          mailboxId: input.mailboxId,
          threadId,
          userId: input.userId,
        });
        for (const message of thread.messages) {
          await prepareSyncMessage(bodies, input.mailboxId, message);
        }
      }
      await repository.transaction(input.mailboxId, async (context) => {
        await projectManagedMailbox(context, { threadIds: input.threadIds });
      });
    } else {
      await runAuthorizedGmailMailbox(
        { mailboxId: input.mailboxId, userId: input.userId },
        async (token) => {
          await hydrateGmailThreads(
            repository,
            bodies,
            input.mailboxId,
            gmailSyncProvider(token, AbortSignal.timeout(45_000)),
            input.threadIds
          );
        }
      );
    }
    const snapshot = await repository.snapshot(
      input.mailboxId,
      input.threadIds
    );
    return snapshot === null
      ? null
      : {
          ...snapshot,
          entities: visibleSyncChanges(snapshot.entities, input.userId),
        };
  },
  refresh: async (input: { mailboxId: string; userId: string }) => {
    await authorizeSyncMailbox(input.mailboxId, input.userId);
    const result = await runMailboxSynchronization(input.mailboxId);
    if (result.hasMore) {
      await mailSyncServices().enqueue(input.mailboxId);
    }
  },
  replay: async (input: {
    mailboxId: string;
    userId: string;
    checkpoint: SyncCheckpoint;
  }) => {
    await authorizeSyncMailbox(input.mailboxId, input.userId);
    const replay = await mailSyncServices().repository.replay(
      input.mailboxId,
      input.checkpoint
    );
    return {
      ...replay,
      batches: replay.batches.map((batch) => ({
        ...batch,
        changes: visibleSyncChanges(batch.changes, input.userId),
      })),
    };
  },
  snapshot: async (input: {
    mailboxId: string;
    userId: string;
    threadIds?: string[];
  }) => {
    await authorizeSyncMailbox(input.mailboxId, input.userId);
    const { repository, enqueue } = mailSyncServices();
    const [stream] = await db
      .select()
      .from(mailSyncStream)
      .where(eq(mailSyncStream.mailboxId, input.mailboxId));
    if (!stream?.initialized) {
      const result = await runMailboxSynchronization(input.mailboxId);
      if (result.hasMore) {
        await enqueue(input.mailboxId);
      }
    }
    const snapshot = await repository.snapshot(
      input.mailboxId,
      input.threadIds
    );
    return snapshot === null
      ? null
      : {
          ...snapshot,
          entities: visibleSyncChanges(snapshot.entities, input.userId),
        };
  },
};
