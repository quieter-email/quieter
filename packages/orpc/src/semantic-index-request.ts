import { ORPCError } from "@orpc/server";
import type { AiRequestStageMeasurement } from "@quieter/ai/search-embeddings";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import { semanticIndexRequest } from "@quieter/database/schema";
import { sql } from "drizzle-orm";

import { assertAccessibleMailbox } from "./mailbox/service";

type SemanticIndexScope = Pick<
  typeof semanticIndexRequest.$inferSelect,
  "kind" | "mailboxId" | "userId"
>;

export type SemanticIndexRequestDiagnostics = {
  stages: Partial<
    Record<"authorization" | "persist", AiRequestStageMeasurement>
  >;
};

export const requestSemanticIndex = async (
  input: SemanticIndexScope & {
    onDiagnostics?: (diagnostics: SemanticIndexRequestDiagnostics) => void;
  }
) => {
  const diagnostics: SemanticIndexRequestDiagnostics = { stages: {} };
  let activeStage: {
    name: keyof SemanticIndexRequestDiagnostics["stages"];
    startedAt: number;
  } | null = null;
  const recordStage = (
    next: keyof SemanticIndexRequestDiagnostics["stages"] | null,
    failed = false
  ) => {
    if (input.onDiagnostics === undefined) {
      return;
    }
    if (activeStage !== null) {
      const previous = diagnostics.stages[activeStage.name];
      diagnostics.stages[activeStage.name] = {
        calls: (previous?.calls ?? 0) + 1,
        ms: (previous?.ms ?? 0) + performance.now() - activeStage.startedAt,
        state: failed || previous?.state === "failed" ? "failed" : "returned",
      };
    }
    activeStage =
      next === null ? null : { name: next, startedAt: performance.now() };
  };
  try {
    recordStage("authorization");
    await assertAccessibleMailbox(input);
    recordStage(null);
    const now = new Date();
    const availableAt = new Date(now.getTime() + 30_000);
    recordStage("persist");
    await db
      .insert(semanticIndexRequest)
      .values({
        availableAt,
        kind: input.kind,
        mailboxId: input.mailboxId,
        requestedAt: now,
        userId: input.userId,
      })
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
    recordStage(null);
  } finally {
    recordStage(null, true);
    try {
      input.onDiagnostics?.(diagnostics);
    } catch {
      // Ignore diagnostic observer failures.
    }
  }
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
