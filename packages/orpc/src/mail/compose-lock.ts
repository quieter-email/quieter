import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { gmailComposeOperation } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, inArray, lt, or } from "drizzle-orm";

export const withMailComposeLock = async <Result>(
  mailboxId: string,
  identity: string,
  run: () => Promise<Result>
): Promise<Result> => {
  const now = new Date();
  const owner = randomUUID();
  const operationKey = `lock:${identity}`;
  await db
    .insert(gmailComposeOperation)
    .values({
      createdAt: now,
      id: randomUUID(),
      kind: "save",
      mailboxId,
      messageHeaderId: "",
      operationKey,
      requestHash: "",
      status: "prepared",
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [lock] = await db
    .update(gmailComposeOperation)
    .set({ requestHash: owner, status: "submitting", updatedAt: now })
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, mailboxId),
        eq(gmailComposeOperation.operationKey, operationKey),
        or(
          inArray(gmailComposeOperation.status, ["prepared", "accepted"]),
          lt(gmailComposeOperation.updatedAt, new Date(now.getTime() - 120_000))
        )
      )
    )
    .returning({ id: gmailComposeOperation.id });
  if (lock === undefined) {
    throw new ORPCError("CONFLICT", {
      message:
        "This draft is being saved or sent elsewhere. Try again in a moment.",
    });
  }
  try {
    return await run();
  } finally {
    await db
      .update(gmailComposeOperation)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(gmailComposeOperation.id, lock.id),
          eq(gmailComposeOperation.requestHash, owner)
        )
      )
      .catch((error: unknown) => {
        reportError(error, { operation: "compose-release-lock" });
      });
  }
};
