import { ORPCError } from "@orpc/server";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import { semanticIndexRequest } from "@quieter/database/schema";
import { sql } from "drizzle-orm";

import { assertAccessibleMailbox } from "./mailbox/service";

type SemanticIndexScope = Pick<
  typeof semanticIndexRequest.$inferSelect,
  "kind" | "mailboxId" | "userId"
>;

export const requestSemanticIndex = async (input: SemanticIndexScope) => {
  await assertAccessibleMailbox(input);
  const now = new Date();
  const availableAt = new Date(now.getTime() + 30_000);
  await db
    .insert(semanticIndexRequest)
    .values({ ...input, availableAt, requestedAt: now })
    .onConflictDoUpdate({
      set: {
        availableAt: sql`case when ${semanticIndexRequest.completedAt} is not null
          and ${semanticIndexRequest.lastError} is null
          and (${semanticIndexRequest.leaseExpiresAt} is null or ${semanticIndexRequest.leaseExpiresAt} <= ${now.toISOString()}::timestamp)
          then least(${semanticIndexRequest.availableAt}, ${availableAt.toISOString()}::timestamp) else ${semanticIndexRequest.availableAt} end`,
        requestedAt: now,
      },
      target: [
        semanticIndexRequest.userId,
        semanticIndexRequest.mailboxId,
        semanticIndexRequest.kind,
      ],
    });
};

export const requestFullMailSemanticIndex = async (
  input: Omit<SemanticIndexScope, "kind">
) => {
  const selectedMailbox = await assertAccessibleMailbox(input);
  if (selectedMailbox.provider !== "gmail") {
    throw new ORPCError("BAD_REQUEST", {
      message: "This mailbox already retains its messages.",
    });
  }
  await createMailboxAiBillingContext({
    externalId: `semantic-import:${crypto.randomUUID()}`,
    mailboxId: input.mailboxId,
    usageKind: "aiMemory",
    userId: input.userId,
  });
  const now = new Date();
  await db
    .insert(semanticIndexRequest)
    .values({
      ...input,
      availableAt: now,
      kind: "mail",
      mailImportRequestedAt: now,
      requestedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        availableAt: sql`case when ${semanticIndexRequest.lastError} is null
        and (${semanticIndexRequest.leaseExpiresAt} is null or ${semanticIndexRequest.leaseExpiresAt} <= ${now.toISOString()}::timestamp)
        then least(${semanticIndexRequest.availableAt}, ${now.toISOString()}::timestamp) else ${semanticIndexRequest.availableAt} end`,
        mailImportRequestedAt: sql`coalesce(${semanticIndexRequest.mailImportRequestedAt}, ${now.toISOString()}::timestamp)`,
        requestedAt: now,
      },
      target: [
        semanticIndexRequest.userId,
        semanticIndexRequest.mailboxId,
        semanticIndexRequest.kind,
      ],
    });
};
