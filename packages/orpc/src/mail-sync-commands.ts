import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailSyncCommand } from "@quieter/database/schema";
import { isGmailServiceError } from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import type { SyncCommand } from "@quieter/sync";
import {
  SyncCommandConflictError,
  SyncCommands,
} from "@quieter/sync-server/commands";
import {
  fetchGmailSyncThreads,
  gmailSyncProvider,
  projectGmailThreads,
} from "@quieter/sync-server/gmail";
import { and, eq } from "drizzle-orm";

import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";
import {
  getMailSyncConfiguration,
  mailSyncServices,
} from "./mail-sync-runtime";
import { mutationsMailOperations } from "./mail/mutations";
import { getAuthorizedManagedMailbox } from "./mailbox/access";
import { assertAccessibleMailbox } from "./mailbox/service";

export const mailSyncCommandService = () => {
  const { repository, bodies } = mailSyncServices();
  return new SyncCommands(repository, {
    classifyError: (error) => {
      if (
        error instanceof ORPCError &&
        typeof error.code === "string" &&
        [
          "BAD_REQUEST",
          "FORBIDDEN",
          "NOT_FOUND",
          "UNAUTHORIZED",
          "CONFLICT",
        ].includes(error.code)
      ) {
        return { message: error.message, permanent: true };
      }
      return {
        message: "This action could not be completed. Please try again.",
        permanent:
          isGmailServiceError(error) &&
          [400, 401, 403, 404].includes(error.status),
      };
    },
    execute: async (command, userId) => {
      const selected = await assertAccessibleMailbox({
        mailboxId: command.mailboxId,
        userId,
      });
      const result = await mutationsMailOperations.applyChanges({
        context: { signal: AbortSignal.timeout(45_000), userId },
        input: command,
      });
      if (result.targets.some((target) => target.status !== "applied")) {
        throw new ORPCError("CONFLICT", {
          message:
            "Some messages changed before this action completed. Please try again.",
        });
      }
      if (selected.provider === "managed") {
        return {};
      }
      const threads = await runAuthorizedGmailMailbox(
        { mailboxId: command.mailboxId, userId },
        async (token) =>
          await fetchGmailSyncThreads(
            gmailSyncProvider(token, AbortSignal.timeout(45_000)),
            bodies,
            command.mailboxId,
            command.targets.map((target) => target.threadId)
          )
      );
      return {
        project: async (context) => {
          await projectGmailThreads(context, threads);
        },
      };
    },
    reportError: (error) => {
      if (
        !(error instanceof ORPCError) &&
        !(
          isGmailServiceError(error) &&
          [400, 401, 403, 404, 429].includes(error.status)
        )
      ) {
        reportError(error, { operation: "mail_sync_command" });
      }
    },
  });
};

export const submitMailSyncCommand = async (
  input: SyncCommand,
  userId: string
) => {
  if (getMailSyncConfiguration() === null) {
    throw new ORPCError("NOT_FOUND");
  }
  const selected = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId,
  });
  if (selected.provider === "managed") {
    await getAuthorizedManagedMailbox({
      mailboxId: input.mailboxId,
      requiredRoles: ["responder", "manager"],
      userId,
    });
  }
  if (input.command.kind === "delete-permanently") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Permanent bulk deletion is unavailable.",
    });
  }
  let receipt;
  try {
    receipt = await mailSyncCommandService().submit(userId, input);
  } catch (error) {
    if (error instanceof SyncCommandConflictError) {
      throw new ORPCError("CONFLICT", { message: error.message });
    }
    throw error;
  }
  try {
    await mailSyncServices().enqueue(input.mailboxId);
  } catch (error) {
    reportError(error, { operation: "mail_sync_command_wake" });
  }
  return receipt;
};

export const getMailSyncCommand = async (
  mailboxId: string,
  commandId: string,
  userId: string
) => {
  await assertAccessibleMailbox({ mailboxId, userId });
  const [record] = await db
    .select({
      commandId: mailSyncCommand.commandId,
      error: mailSyncCommand.error,
      status: mailSyncCommand.status,
    })
    .from(mailSyncCommand)
    .where(
      and(
        eq(mailSyncCommand.mailboxId, mailboxId),
        eq(mailSyncCommand.commandId, commandId),
        eq(mailSyncCommand.userId, userId)
      )
    );
  return record ?? null;
};
