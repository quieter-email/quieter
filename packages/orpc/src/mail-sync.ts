import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailSyncEntity,
  mailSyncProviderState,
  mailSyncStream,
} from "@quieter/database/schema";
import type { SyncCheckpoint } from "@quieter/sync";
import { createSyncTicket } from "@quieter/sync-server/auth";
import {
  prepareSyncMessage,
  readSyncBody,
} from "@quieter/sync-server/body-store";
import {
  fetchGmailSyncThreads,
  gmailSyncProvider,
  projectGmailThreads,
  synchronizeGmail,
} from "@quieter/sync-server/gmail";
import {
  bootstrapManagedMailbox,
  projectManagedMailbox,
} from "@quieter/sync-server/managed";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";
import {
  getMailSyncConfiguration,
  mailSyncServices,
} from "./mail-sync-runtime";
import { assertAccessibleMailbox } from "./mailbox/service";
import { getManagedThread } from "./managed-mail/messages/service";

export {
  getMailSyncConfiguration,
  mailSyncServices,
  withMailSyncRuntime,
} from "./mail-sync-runtime";
export const authorizeSyncMailbox = async (mailboxId: string, userId: string) =>
  await assertAccessibleMailbox({ mailboxId, userId });

export const runMailboxSynchronization = async (mailboxId: string) => {
  if (getMailSyncConfiguration() === null) {
    return { hasMore: false };
  }
  const [selected] = await db
    .select()
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId));
  if (selected === undefined || selected.status !== "connected") {
    return { hasMore: false };
  }
  const { bodies, repository } = mailSyncServices();
  if (selected.provider === "managed") {
    await bootstrapManagedMailbox(repository, bodies, mailboxId);
    return { hasMore: false };
  }
  if (!selected.ownerUserId) {
    throw new Error("Mailbox ownership is missing.");
  }
  return await runAuthorizedGmailMailbox(
    { mailboxId, userId: selected.ownerUserId },
    async (token) =>
      await synchronizeGmail(
        repository,
        bodies,
        mailboxId,
        gmailSyncProvider(token, AbortSignal.timeout(45_000))
      )
  );
};

export const maintainMailSynchronization = async () => {
  if (getMailSyncConfiguration() === null) {
    return;
  }
  const { repository, enqueue } = mailSyncServices();
  await repository.recoverOutbox();
  const due = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .leftJoin(mailSyncStream, eq(mailSyncStream.mailboxId, mailbox.id))
    .leftJoin(
      mailSyncProviderState,
      eq(mailSyncProviderState.mailboxId, mailbox.id)
    )
    .where(
      and(
        eq(mailbox.status, "connected"),
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
  connection: (userId: string) => {
    const configuration = getMailSyncConfiguration();
    if (configuration === null) {
      return { url: null };
    }
    const url = new URL("/connect", configuration.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(
      "ticket",
      createSyncTicket(userId, configuration.secret)
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
          const threads = await fetchGmailSyncThreads(
            gmailSyncProvider(token, AbortSignal.timeout(45_000)),
            bodies,
            input.mailboxId,
            input.threadIds
          );
          await repository.transaction(input.mailboxId, async (context) => {
            await projectGmailThreads(context, threads);
          });
        }
      );
    }
    return await repository.snapshot(input.mailboxId, input.threadIds);
  },
  replay: async (input: {
    mailboxId: string;
    userId: string;
    checkpoint: SyncCheckpoint;
  }) => {
    await authorizeSyncMailbox(input.mailboxId, input.userId);
    return await mailSyncServices().repository.replay(
      input.mailboxId,
      input.checkpoint
    );
  },
  snapshot: async (input: {
    mailboxId: string;
    userId: string;
    threadIds?: string[];
  }) => {
    await authorizeSyncMailbox(input.mailboxId, input.userId);
    if (getMailSyncConfiguration() === null) {
      return null;
    }
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
    return await repository.snapshot(input.mailboxId, input.threadIds);
  },
};
