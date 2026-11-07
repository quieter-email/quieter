import { ORPCError } from "@orpc/server";
import {
  isAiCreditAdmissionBusy,
  isTransientAiProviderError,
} from "@quieter/ai/errors";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import { semanticIndexRequest } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { assertAccessibleMailbox } from "./mailbox/service";
import { advanceSemanticMailImport } from "./semantic-mail-import";
import { indexSemanticSources } from "./semantic-search";

export {
  requestSemanticIndex,
  requestFullMailSemanticIndex,
} from "./semantic-index-request";

export const processPendingSemanticIndexes = async (
  input: {
    allowLocal?: boolean;
    limit?: number;
    mailboxId?: string;
    userId?: string;
  } = {}
) => {
  const options = z
    .object({
      allowLocal: z.boolean().default(false),
      limit: z.number().int().min(1).max(10).default(3),
      mailboxId: z.string().min(1).optional(),
      userId: z.string().min(1).optional(),
    })
    .parse(input);
  if (
    options.allowLocal &&
    (options.userId === undefined || options.mailboxId === undefined)
  ) {
    throw new Error("Choose one local user and mailbox to prepare search.");
  }
  const result = { cancelled: 0, failed: 0, processed: 0 };
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local" && !options.allowLocal) {
    return result;
  }
  const now = new Date();
  const eligible = and(
    options.allowLocal
      ? or(
          lte(semanticIndexRequest.availableAt, now),
          and(
            eq(semanticIndexRequest.attemptCount, 0),
            isNull(semanticIndexRequest.lastError)
          )
        )
      : lte(semanticIndexRequest.availableAt, now),
    or(
      isNull(semanticIndexRequest.leaseExpiresAt),
      lte(semanticIndexRequest.leaseExpiresAt, now)
    ),
    options.userId === undefined
      ? undefined
      : eq(semanticIndexRequest.userId, options.userId),
    options.mailboxId === undefined
      ? undefined
      : eq(semanticIndexRequest.mailboxId, options.mailboxId)
  );
  const pending = await db
    .select()
    .from(semanticIndexRequest)
    .where(eligible)
    .orderBy(
      asc(semanticIndexRequest.availableAt),
      asc(semanticIndexRequest.requestedAt),
      asc(semanticIndexRequest.userId),
      asc(semanticIndexRequest.mailboxId),
      asc(semanticIndexRequest.kind)
    )
    .limit(options.limit);
  const deadline = Date.now() + 55_000;
  for (const request of pending) {
    if (Date.now() >= deadline) {
      break;
    }
    const leaseToken = crypto.randomUUID();
    const identity = and(
      eq(semanticIndexRequest.userId, request.userId),
      eq(semanticIndexRequest.mailboxId, request.mailboxId),
      eq(semanticIndexRequest.kind, request.kind)
    );
    const [claimed] = await db
      .update(semanticIndexRequest)
      .set({
        leaseExpiresAt: new Date(Date.now() + 120_000),
        leaseToken,
      })
      .where(and(identity, eligible))
      .returning();
    if (claimed === undefined) {
      continue;
    }
    const ownedLease = and(
      identity,
      eq(semanticIndexRequest.leaseToken, leaseToken),
      gt(semanticIndexRequest.leaseExpiresAt, sql`now()`)
    );
    try {
      const signal = AbortSignal.timeout(
        Math.max(1, Math.min(30_000, deadline - Date.now()))
      );
      let imported =
        request.mailImportRequestedAt === null ||
        request.mailImportedAt !== null;
      if (request.kind === "mail" && !imported) {
        await createMailboxAiBillingContext({
          externalId: `semantic-import:${crypto.randomUUID()}`,
          mailboxId: request.mailboxId,
          usageKind: "aiMemory",
          userId: request.userId,
        });
        const progress = await advanceSemanticMailImport({
          mailboxId: request.mailboxId,
          pageToken: request.mailImportPageToken,
          pendingIds: request.mailImportPendingIds,
          signal,
          userId: request.userId,
        });
        const checkpoint = await db
          .update(semanticIndexRequest)
          .set({
            mailImportPageToken: progress.pageToken,
            mailImportPendingIds: progress.pendingIds,
            mailImportedAt: progress.complete ? new Date() : null,
          })
          .where(ownedLease)
          .returning({ kind: semanticIndexRequest.kind });
        if (checkpoint.length === 0) {
          continue;
        }
        imported = progress.complete;
      }
      const coverage = await indexSemanticSources({
        kind: request.kind,
        mailboxId: request.mailboxId,
        signal,
        userId: request.userId,
      });
      const complete = coverage.complete && imported;
      const completed = await db
        .update(semanticIndexRequest)
        .set({
          attemptCount: 0,
          availableAt: new Date(Date.now() + (complete ? 300_000 : 0)),
          completedAt: complete ? new Date() : null,
          indexedSources: coverage.indexedSources,
          lastError: null,
          leaseExpiresAt: null,
          leaseToken: null,
          totalSources: coverage.totalSources,
        })
        .where(ownedLease)
        .returning({ kind: semanticIndexRequest.kind });
      result.processed += completed.length;
    } catch (error) {
      let accessRevoked = false;
      try {
        await assertAccessibleMailbox(request);
      } catch (accessError) {
        if (
          accessError instanceof ORPCError &&
          [401, 403, 404].includes(accessError.status)
        ) {
          accessRevoked = true;
        }
      }
      if (accessRevoked) {
        const cancelled = await db
          .delete(semanticIndexRequest)
          .where(ownedLease)
          .returning({ kind: semanticIndexRequest.kind });
        result.cancelled += cancelled.length;
        continue;
      }
      const expected =
        isAiCreditAdmissionBusy(error) ||
        isTransientAiProviderError(error) ||
        (error instanceof ORPCError && error.status < 500);
      const delay = Math.min(
        3_600_000,
        30_000 * 2 ** Math.min(7, claimed.attemptCount)
      );
      const failed = await db
        .update(semanticIndexRequest)
        .set({
          attemptCount: sql`${semanticIndexRequest.attemptCount} + 1`,
          availableAt: new Date(Date.now() + delay),
          lastError: expected
            ? "Search preparation is waiting for access or available usage."
            : "Search preparation could not finish. It will retry.",
          leaseExpiresAt: null,
          leaseToken: null,
        })
        .where(ownedLease)
        .returning({ kind: semanticIndexRequest.kind });
      if (!expected) {
        reportError(new Error("Pending search preparation failed."), {
          operation: "semantic-index:process-pending",
        });
      }
      result.failed += failed.length;
    }
  }
  return result;
};
