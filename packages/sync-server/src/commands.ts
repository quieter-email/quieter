import { createHash } from "node:crypto";

import { mailSyncCommand } from "@quieter/database/schema";
import { syncCommandSchema } from "@quieter/sync";
import type { SyncCommand } from "@quieter/sync";
import { and, asc, eq, inArray } from "drizzle-orm";

import { SyncCommandConflictError } from "./command-conflict";
import {
  assertProviderLease,
  SyncProviderBusyError,
  withProviderLease,
} from "./providers/lease";
import type { SyncRepository, SyncTransaction } from "./repository";

export { SyncCommandConflictError } from "./command-conflict";

type CommandRecord = typeof mailSyncCommand.$inferSelect;
type CommandDependencies = {
  execute: (
    command: SyncCommand,
    userId: string
  ) => Promise<{ project?: (context: SyncTransaction) => Promise<void> }>;
  classifyError: (error: unknown) => { permanent: boolean; message: string };
  reportError: (error: unknown) => void;
};

export class SyncCommands {
  private readonly repository: SyncRepository;
  private readonly dependencies: CommandDependencies;
  constructor(repository: SyncRepository, dependencies: CommandDependencies) {
    this.repository = repository;
    this.dependencies = dependencies;
  }

  async submit(userId: string, input: SyncCommand) {
    const command = syncCommandSchema.parse(input);
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    return await this.repository.transaction(
      command.mailboxId,
      async (context) => {
        const [existing] = await context.database
          .select()
          .from(mailSyncCommand)
          .where(
            and(
              eq(mailSyncCommand.mailboxId, command.mailboxId),
              eq(mailSyncCommand.commandId, command.commandId)
            )
          )
          .for("update");
        if (existing !== undefined) {
          if (
            existing.userId !== userId ||
            existing.payloadHash !== payloadHash
          ) {
            throw new SyncCommandConflictError();
          }
          return {
            commandId: command.commandId,
            error: existing.error,
            status: existing.status,
          };
        }
        await context.database.insert(mailSyncCommand).values({
          commandId: command.commandId,
          mailboxId: command.mailboxId,
          payload: command,
          payloadHash,
          sequence: context.sequence,
          userId,
        });
        context.put({
          data: {
            kind: "command",
            value: {
              command,
              error: null,
              status: "accepted",
              updatedAt: new Date().toISOString(),
            },
          },
          id: command.commandId,
          kind: "command",
        });
        return {
          commandId: command.commandId,
          error: null,
          status: "accepted" as const,
        };
      }
    );
  }

  async process(mailboxId: string) {
    return await withProviderLease(
      this.repository,
      mailboxId,
      async (_state, leaseId) => {
        const [pending] = await this.repository.database
          .select()
          .from(mailSyncCommand)
          .where(
            and(
              eq(mailSyncCommand.mailboxId, mailboxId),
              inArray(mailSyncCommand.status, ["accepted", "running"])
            )
          )
          .orderBy(asc(mailSyncCommand.sequence))
          .limit(1);
        if (pending === undefined) {
          return false;
        }
        if (pending.nextAttemptAt.getTime() > Date.now()) {
          throw new SyncProviderBusyError();
        }
        await this.repository.database
          .update(mailSyncCommand)
          .set({
            attempts: pending.attempts + 1,
            leaseId,
            nextAttemptAt: new Date(Date.now() + 60_000),
            status: "running",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mailSyncCommand.mailboxId, mailboxId),
              eq(mailSyncCommand.commandId, pending.commandId)
            )
          );
        try {
          const result = await this.dependencies.execute(
            pending.payload,
            pending.userId
          );
          await this.repository.transaction(mailboxId, async (context) => {
            await assertProviderLease(context, leaseId);
            await result.project?.(context);
            await SyncCommands.recordOutcome(context, pending, "applied", null);
          });
        } catch (error) {
          const failure = this.dependencies.classifyError(error);
          this.dependencies.reportError(error);
          await this.repository.transaction(mailboxId, async (context) => {
            await assertProviderLease(context, leaseId);
            const status =
              failure.permanent || pending.attempts >= 9
                ? "failed"
                : "accepted";
            await SyncCommands.recordOutcome(
              context,
              pending,
              status,
              status === "failed" ? failure.message : null
            );
          });
        }
        return true;
      }
    );
  }

  private static async recordOutcome(
    context: SyncTransaction,
    pending: CommandRecord,
    status: "accepted" | "applied" | "failed",
    error: string | null
  ) {
    const updatedAt = new Date();
    await context.database
      .update(mailSyncCommand)
      .set({
        error,
        leaseId: null,
        nextAttemptAt: new Date(
          Date.now() + Math.min(300_000, 1000 * 2 ** pending.attempts)
        ),
        status,
        updatedAt,
      })
      .where(
        and(
          eq(mailSyncCommand.mailboxId, context.mailboxId),
          eq(mailSyncCommand.commandId, pending.commandId)
        )
      );
    context.put({
      data: {
        kind: "command",
        value: {
          command: pending.payload,
          error,
          status,
          updatedAt: updatedAt.toISOString(),
        },
      },
      id: pending.commandId,
      kind: "command",
    });
  }
}
