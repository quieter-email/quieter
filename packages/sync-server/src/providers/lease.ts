import { mailSyncProviderState } from "@quieter/database/schema";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { SyncRepository, SyncTransaction } from "../repository";

export class SyncProviderBusyError extends Error {
  constructor() {
    super("Mailbox synchronization is already running.");
    this.name = "SyncProviderBusyError";
  }
}

export const withProviderLease = async <Result>(
  repository: SyncRepository,
  mailboxId: string,
  run: (
    state: typeof mailSyncProviderState.$inferSelect,
    leaseId: string
  ) => Promise<Result>
): Promise<Result> => {
  await repository.database
    .insert(mailSyncProviderState)
    .values({ mailboxId })
    .onConflictDoNothing();
  const leaseId = crypto.randomUUID();
  const [state] = await repository.database
    .update(mailSyncProviderState)
    .set({ leaseExpiresAt: new Date(Date.now() + 60_000), leaseId })
    .where(
      and(
        eq(mailSyncProviderState.mailboxId, mailboxId),
        or(
          isNull(mailSyncProviderState.leaseExpiresAt),
          lt(mailSyncProviderState.leaseExpiresAt, new Date())
        )
      )
    )
    .returning();
  if (state === undefined) {
    throw new SyncProviderBusyError();
  }
  try {
    return await run(state, leaseId);
  } finally {
    await repository.database
      .update(mailSyncProviderState)
      .set({ leaseExpiresAt: null, leaseId: null })
      .where(
        and(
          eq(mailSyncProviderState.mailboxId, mailboxId),
          eq(mailSyncProviderState.leaseId, leaseId)
        )
      );
  }
};

export const assertProviderLease = async (
  context: SyncTransaction,
  leaseId: string
) => {
  const [fence] = await context.database
    .select()
    .from(mailSyncProviderState)
    .where(eq(mailSyncProviderState.mailboxId, context.mailboxId))
    .for("update");
  if (
    fence?.leaseId !== leaseId ||
    fence.leaseExpiresAt === null ||
    fence.leaseExpiresAt.getTime() <= Date.now()
  ) {
    throw new Error("Mailbox processing ownership expired.");
  }
};
