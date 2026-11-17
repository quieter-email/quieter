import { randomUUID } from "node:crypto";

import {
  mailbox,
  mailMessageOperation,
  mailPlacementOperation,
  mailSnooze,
  mailSnoozeOperation,
  mailUndoAttempt,
  organization,
  user,
} from "@quieter/database/schema";
import { mailUndoInputSchema } from "@quieter/mail/undo";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, test } from "vite-plus/test";

import {
  createMailUndoCutoff,
  mailUndoOriginalSchema,
  mailUndoPlanningSchema,
  planMailUndo,
} from "../src/mail/undo-model";
import type { MailUndoOriginal } from "../src/mail/undo-model";
import {
  mailUndoProgressEventSchema,
  projectMailUndoProgress,
} from "../src/mail/undo-progress";
import {
  captureMailUndoExecution,
  getMailUndoOffer,
  finishMailUndoWithoutEffects,
  loadMailUndoExecution,
  persistMailUndoOriginal,
  prepareMailUndoRequest,
  transitionMailUndoState,
} from "../src/mail/undo-state";

const databaseUrl = process.env.QUIETER_TEST_UNDO_DATABASE_URL;
if (databaseUrl !== undefined) {
  const parsed = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/quieter_undo_fixture" ||
    parsed.searchParams.size !== 0
  ) {
    throw new Error(
      "Undo tests require a dedicated loopback quieter_undo_fixture database."
    );
  }
}
const client = postgres(
  databaseUrl ?? "postgresql://postgres@127.0.0.1:1/quieter_undo_fixture",
  { connect_timeout: 3, max: 1, onnotice: () => {} }
);
const raceClient = postgres(
  databaseUrl ?? "postgresql://postgres@127.0.0.1:1/quieter_undo_fixture",
  { connect_timeout: 3, max: 2, onnotice: () => {} }
);
const database = drizzle({ client });
const raceDatabase = drizzle({ client: raceClient });
const authority = {
  actorUserId: "undo-fixture-actor",
  canWrite: true,
  mailboxId: "undo-fixture-mailbox",
};

const seedOriginal = async (
  count = 1,
  facet: "read" | "destination" = "read"
): Promise<MailUndoOriginal> => {
  const admittedAt = new Date();
  const operationId = randomUUID();
  const token = randomUUID();
  const messageIds = Array.from(
    { length: count },
    (_, index) => `source-${operationId}-${index}`
  );
  const original = mailUndoOriginalSchema.parse({
    actorUserId: authority.actorUserId,
    admittedAt: admittedAt.toISOString(),
    cutoff: createMailUndoCutoff({
      admittedAt: admittedAt.toISOString(),
      previousReturnAt: null,
    }),
    kind: "message",
    mailboxId: authority.mailboxId,
    operationId,
    proof: {
      effects: messageIds.map((messageId, index) => ({
        ...(facet === "read"
          ? { after: true, before: false, facet }
          : {
              after: { kind: "managed", value: "trash" },
              before: {
                kind: "managed",
                value: index === 0 ? "inbox" : "spam",
              },
              facet,
            }),
        intentToken: token,
        messageId,
        outcome: {
          proof: { kind: "managed-revision", revision: "1" },
          status: "acknowledged",
        },
        phaseId: randomUUID(),
      })),
    },
    threadId: `thread-${operationId}`,
  });
  await database.transaction(async (tx) => {
    await tx.insert(mailMessageOperation).values({
      actorUserId: authority.actorUserId,
      command:
        facet === "read"
          ? { facet, read: true }
          : { destination: { kind: "managed", value: "trash" }, facet },
      createdAt: admittedAt,
      id: operationId,
      mailboxId: authority.mailboxId,
      messageIds,
      requestHash: randomUUID(),
      requestId: randomUUID(),
      status: "applied",
      threadId: original.threadId,
      updatedAt: admittedAt,
    });
    await persistMailUndoOriginal({ authority, database: tx, original });
  });
  return original;
};

const capture = async (
  original: MailUndoOriginal,
  changedMessageIds: string[] = []
) => {
  const admissions = await database.transaction(
    async (tx) =>
      await prepareMailUndoRequest({
        authority,
        database: tx,
        input: {
          mailboxId: authority.mailboxId,
          receipts: [`message:${original.operationId}`],
        },
        now: new Date(),
      })
  );
  const [admission] = admissions;
  if (admission?.result.kind !== "accepted") {
    throw new Error("Expected a newly admitted inverse.");
  }
  if (original.kind !== "message" || original.proof === null) {
    throw new Error("Expected a message original.");
  }
  const { items, plan } = planMailUndo(
    mailUndoPlanningSchema.parse({
      actorUserId: authority.actorUserId,
      attempt: admission.result.attempt,
      authority,
      currentMessages: original.proof.effects.map((effect) => {
        const readIntentToken = changedMessageIds.includes(effect.messageId)
          ? randomUUID()
          : effect.intentToken;
        return {
          destination:
            effect.facet === "destination"
              ? effect.after
              : { kind: "managed", value: "inbox" },
          destinationIntentToken:
            effect.facet === "destination" ? effect.intentToken : null,
          mailboxId: authority.mailboxId,
          messageId: effect.messageId,
          read: effect.facet === "read" ? effect.after : false,
          readIntentToken: effect.facet === "read" ? readIntentToken : null,
          source: {
            destinationRevision: effect.facet === "destination" ? "1" : "0",
            kind: "managed-revision",
            readRevision: effect.facet === "read" ? "1" : "0",
          },
          threadId: original.threadId,
        };
      }),
      currentSchedule: null,
      latestPlacement: null,
      mailboxId: authority.mailboxId,
      now: new Date().toISOString(),
      original,
    })
  );
  if (plan === null) {
    throw new Error("Expected a current compensation plan.");
  }
  return await database.transaction(
    async (tx) =>
      await captureMailUndoExecution({
        attemptId:
          admission.result.kind === "accepted"
            ? admission.result.attempt.id
            : "",
        authority,
        database: tx,
        items,
        plan,
      })
  );
};

describe.skipIf(databaseUrl === undefined)("native retained Undo state", () => {
  beforeEach(async () => {
    await database
      .delete(organization)
      .where(eq(organization.id, "undo-fixture-org"));
    await database.delete(user).where(eq(user.id, authority.actorUserId));
    const now = new Date();
    await database.insert(user).values({
      createdAt: now,
      email: "undo-fixture@example.invalid",
      emailVerified: true,
      id: authority.actorUserId,
      name: "Undo fixture",
      updatedAt: now,
    });
    await database.insert(organization).values({
      createdAt: now,
      id: "undo-fixture-org",
      name: "Undo fixture",
      slug: "undo-fixture-org",
    });
    await database.insert(mailbox).values({
      accessMode: "shared",
      createdAt: now,
      emailAddress: "undo-inbox@example.invalid",
      id: authority.mailboxId,
      organizationId: "undo-fixture-org",
      provider: "managed",
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await client.end();
    await raceClient.end();
  });

  test("retains one identity and original cutoff across an expired retry and denied scopes", async () => {
    const original = await seedOriginal();
    const input = mailUndoInputSchema.parse({
      mailboxId: authority.mailboxId,
      receipts: [`message:${original.operationId}`],
    });
    const offer = await getMailUndoOffer({
      authority,
      database,
      now: new Date(),
      receiptIds: input.receipts,
    });
    expect(offer?.receipts).toMatchObject([
      { expiresAt: original.cutoff, id: input.receipts[0] },
    ]);
    await expect(
      getMailUndoOffer({
        authority,
        database,
        now: new Date(Date.parse(original.cutoff) + 1000),
        receiptIds: input.receipts,
      })
    ).resolves.toBeNull();
    const first = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input,
          now: new Date(),
        })
    );
    const later = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input,
          now: new Date(Date.parse(original.cutoff) + 1000),
        })
    );
    expect(first[0]?.result.kind).toBe("accepted");
    expect(later[0]?.result).toMatchObject({
      attempt:
        first[0]?.result.kind === "accepted" ? first[0].result.attempt : null,
      kind: "replay",
    });
    await expect(
      database.transaction(
        async (tx) =>
          await prepareMailUndoRequest({
            authority: { ...authority, canWrite: false },
            database: tx,
            input,
            now: new Date(),
          })
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const wrongActor = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority: { ...authority, actorUserId: "different-actor" },
          database: tx,
          input,
          now: new Date(),
        })
    );
    expect(wrongActor[0]).toMatchObject({
      original: null,
      result: { kind: "blocked" },
    });
    const rows = await database.select().from(mailUndoAttempt);
    expect(rows).toHaveLength(1);
  });

  test("rejects combined sources before any new admission even when a retained attempt has empty items", async () => {
    const retained = await seedOriginal(600);
    const fresh = await seedOriginal(401);
    await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input: {
            mailboxId: authority.mailboxId,
            receipts: [`message:${retained.operationId}`],
          },
          now: new Date(),
        })
    );
    await expect(
      database.transaction(
        async (tx) =>
          await prepareMailUndoRequest({
            authority,
            database: tx,
            input: {
              mailboxId: authority.mailboxId,
              receipts: [
                `message:${retained.operationId}`,
                `message:${fresh.operationId}`,
              ],
            },
            now: new Date(),
          })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const rows = await database.select().from(mailUndoAttempt);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.originalOperationId).toBe(retained.operationId);
  });

  test("withholds malformed or physically mismatched proof without reserving another identity", async () => {
    const original = await seedOriginal();
    await database
      .update(mailMessageOperation)
      .set({ undoProof: { ...original, threadId: "another-thread" } })
      .where(eq(mailMessageOperation.id, original.operationId));
    const result = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input: {
            mailboxId: authority.mailboxId,
            receipts: [`message:${original.operationId}`],
          },
          now: new Date(),
        })
    );
    expect(result[0]).toMatchObject({
      original: null,
      result: { kind: "blocked" },
    });
    await expect(database.select().from(mailUndoAttempt)).resolves.toHaveLength(
      0
    );
  });

  test("uses lossless placement sequence and the actual Snooze journal kind and version", async () => {
    const admittedAt = new Date();
    const hideId = randomUUID();
    const hideRequestId = randomUUID();
    const snoozeId = randomUUID();
    const snoozeOperationId = randomUUID();
    const intentToken = randomUUID();
    const sequence = "9007199254740993";
    const returnAt = new Date(admittedAt.getTime() + 60_000).toISOString();
    const destinationEffect = {
      after: { kind: "managed", value: "done" },
      before: { kind: "managed", value: "inbox" },
      facet: "destination",
      intentToken,
      messageId: "fixture-anchor",
      outcome: {
        proof: { kind: "managed-revision", revision: "1" },
        status: "acknowledged",
      },
      phaseId: randomUUID(),
    };
    const placementOriginal = mailUndoOriginalSchema.parse({
      actorUserId: authority.actorUserId,
      admittedAt: admittedAt.toISOString(),
      cutoff: createMailUndoCutoff({
        admittedAt: admittedAt.toISOString(),
        previousReturnAt: null,
      }),
      kind: "placement",
      mailboxId: authority.mailboxId,
      operationId: hideId,
      proof: { acceptedSequence: sequence, effects: [destinationEffect] },
      threadId: "fixture-conversation",
    });
    const snoozeOriginal = mailUndoOriginalSchema.parse({
      actorUserId: authority.actorUserId,
      admittedAt: admittedAt.toISOString(),
      cutoff: createMailUndoCutoff({
        admittedAt: admittedAt.toISOString(),
        previousReturnAt: null,
      }),
      kind: "snooze",
      mailboxId: authority.mailboxId,
      operationId: snoozeOperationId,
      proof: {
        after: {
          hiddenMessageIds: ["fixture-anchor"],
          hideOperationId: hideId,
          id: snoozeId,
          knownIncomingMessageIds: ["fixture-anchor"],
          returnAt,
          status: "active",
          timeZone: "UTC",
          version: "1",
        },
        command: "snooze",
        completion: "acknowledged",
        effects: [destinationEffect],
        placementPredecessor: {
          actorUserId: authority.actorUserId,
          mailboxId: authority.mailboxId,
          operationId: hideId,
          placement: "done",
          requestId: hideRequestId,
          sequence,
          status: "applied",
          threadId: "fixture-conversation",
        },
      },
      threadId: "fixture-conversation",
    });
    await database.transaction(async (tx) => {
      await tx.insert(mailPlacementOperation).values({
        actorUserId: authority.actorUserId,
        createdAt: admittedAt,
        id: hideId,
        mailboxId: authority.mailboxId,
        messageIds: ["fixture-anchor"],
        placement: "done",
        requestHash: randomUUID(),
        requestId: hideRequestId,
        requestedMessageIds: ["fixture-anchor"],
        sequence: sql`${sequence}::bigint`,
        status: "applied",
        threadId: "fixture-conversation",
        updatedAt: admittedAt,
      });
      await persistMailUndoOriginal({
        authority,
        database: tx,
        original: placementOriginal,
      });
      await tx.insert(mailSnooze).values({
        actorUserId: authority.actorUserId,
        createdAt: admittedAt,
        hiddenMessageIds: ["fixture-anchor"],
        hideOperationId: hideId,
        hideRequestId,
        id: snoozeId,
        knownIncomingMessageIds: ["fixture-anchor"],
        mailboxId: authority.mailboxId,
        returnAt: new Date(returnAt),
        status: "active",
        threadId: "fixture-conversation",
        timeZone: "UTC",
        updatedAt: admittedAt,
        version: 1,
      });
      await tx.insert(mailSnoozeOperation).values({
        actorUserId: authority.actorUserId,
        createdAt: admittedAt,
        expectedVersion: null,
        id: snoozeOperationId,
        kind: "snooze",
        mailboxId: authority.mailboxId,
        requestHash: randomUUID(),
        requestId: randomUUID(),
        resultingVersion: 1,
        snoozeId,
        status: "applied",
        threadId: "fixture-conversation",
        updatedAt: admittedAt,
      });
      await persistMailUndoOriginal({
        authority,
        database: tx,
        original: snoozeOriginal,
      });
    });
    const { receipts } = mailUndoInputSchema.parse({
      mailboxId: authority.mailboxId,
      receipts: [`placement:${hideId}`, `snooze:${snoozeOperationId}`],
    });
    const actualOffer = await getMailUndoOffer({
      authority,
      database,
      now: admittedAt,
      receiptIds: receipts,
    });
    expect(actualOffer?.receipts).toHaveLength(2);
    if (
      placementOriginal.kind !== "placement" ||
      placementOriginal.proof === null
    ) {
      throw new Error("Expected the placement proof.");
    }
    await database
      .update(mailPlacementOperation)
      .set({
        undoProof: {
          ...placementOriginal,
          proof: {
            ...placementOriginal.proof,
            acceptedSequence: "9007199254740992",
          },
        },
      })
      .where(eq(mailPlacementOperation.id, hideId));
    await database
      .update(mailSnoozeOperation)
      .set({ resultingVersion: 2 })
      .where(eq(mailSnoozeOperation.id, snoozeOperationId));
    await expect(
      getMailUndoOffer({
        authority,
        database,
        now: admittedAt,
        receiptIds: receipts,
      })
    ).resolves.toBeNull();
    await database
      .update(mailSnoozeOperation)
      .set({ kind: "cancel", resultingVersion: 1 })
      .where(eq(mailSnoozeOperation.id, snoozeOperationId));
    await expect(
      getMailUndoOffer({
        authority,
        database,
        now: admittedAt,
        receiptIds: receipts,
      })
    ).resolves.toBeNull();
  });

  test("retains partial results and exact phase identity across acknowledgement and original deletion", async () => {
    const original = await seedOriginal(2);
    if (original.kind !== "message" || original.proof === null) {
      throw new Error("Expected the message original.");
    }
    const changedMessageId = original.proof.effects[1]?.messageId;
    if (changedMessageId === undefined) {
      throw new Error("Expected a neighboring changed message.");
    }
    const execution = await capture(original, [changedMessageId]);
    const capturedAgain = await database.transaction(
      async (tx) =>
        await captureMailUndoExecution({
          attemptId: execution.attempt.id,
          authority,
          database: tx,
          items: execution.attempt.items,
          plan: execution.plan,
        })
    );
    expect(capturedAgain.progress).toStrictEqual(execution.progress);
    if (execution.progress.kind !== "effects") {
      throw new Error("Expected retained effects.");
    }
    const [phase] = execution.progress.phases;
    if (phase === undefined) {
      throw new Error("Expected a retained phase.");
    }
    const nativeId = randomUUID();
    const requestedMessageIds = execution.plan.effects.map(
      (effect) => effect.messageId
    );
    const receipt = mailUndoProgressEventSchema.options[0].shape.receipt.parse({
      actorUserId: authority.actorUserId,
      command: { facet: "read", read: false },
      mailboxId: authority.mailboxId,
      operationId: nativeId,
      owner: "message",
      requestId: phase.requestId,
      requestedMessageIds,
      threadId: original.threadId,
    });
    const nativeValues = {
      actorUserId: authority.actorUserId,
      command: receipt.command,
      createdAt: new Date(),
      id: nativeId,
      mailboxId: authority.mailboxId,
      messageIds: requestedMessageIds,
      requestHash: randomUUID(),
      requestId: phase.requestId,
      status: "pending",
      threadId: original.threadId,
      updatedAt: new Date(),
    } satisfies typeof mailMessageOperation.$inferInsert;
    await expect(
      database.transaction(async (tx) => {
        await tx.insert(mailMessageOperation).values(nativeValues);
        return await transitionMailUndoState({
          attemptId: execution.attempt.id,
          authority,
          database: tx,
          event: { kind: "link", phaseId: phase.id, receipt },
        });
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const association = {
      attemptId: execution.attempt.id,
      kind: "mail-undo-phase",
      phaseId: phase.id,
    };
    const linked = await database.transaction(async (tx) => {
      await tx
        .insert(mailMessageOperation)
        .values({ ...nativeValues, undoProof: association });
      return await transitionMailUndoState({
        attemptId: execution.attempt.id,
        authority,
        database: tx,
        event: { kind: "link", phaseId: phase.id, receipt },
      });
    });
    expect(
      linked.progress.kind === "effects" &&
        linked.progress.phases[0]?.native?.operationId
    ).toBe(nativeId);
    const { command, requestedMessageIds: _requested, ...native } = receipt;
    const acknowledgement =
      mailUndoProgressEventSchema.options[1].shape.acknowledgement.parse({
        acknowledgedAt: new Date().toISOString(),
        acknowledgedMessageIds: requestedMessageIds,
        command,
        owner: "message",
        receipt: native,
        requestedMessageIds,
        status: "acknowledged",
      });
    const completed = await database.transaction(async (tx) => {
      await tx
        .update(mailMessageOperation)
        .set({ status: "applied" })
        .where(eq(mailMessageOperation.id, nativeId));
      return await transitionMailUndoState({
        attemptId: execution.attempt.id,
        authority,
        database: tx,
        event: { acknowledgement, kind: "acknowledge", phaseId: phase.id },
      });
    });
    expect(completed.attempt.state).toBe("completed");
    expect(completed.attempt.items).toContainEqual(
      expect.objectContaining({ status: "compensated" })
    );
    expect(completed.attempt.items).toContainEqual(
      expect.objectContaining({
        messageIds: [changedMessageId],
        status: "changed",
      })
    );
    await database
      .delete(mailMessageOperation)
      .where(eq(mailMessageOperation.id, original.operationId));
    const replay = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input: {
            mailboxId: authority.mailboxId,
            receipts: [`message:${original.operationId}`],
          },
          now: new Date(Date.parse(original.cutoff) + 1000),
        })
    );
    expect(replay[0]?.result).toMatchObject({
      attempt: {
        id: execution.attempt.id,
        items: completed.attempt.items,
        liveOriginalOperationId: null,
        state: "completed",
      },
      kind: "replay",
    });
  });

  test("retains a planner refusal without creating a native phase or reviving the original", async () => {
    const original = await seedOriginal();
    const input = mailUndoInputSchema.parse({
      mailboxId: authority.mailboxId,
      receipts: [`message:${original.operationId}`],
    });
    const [admission] = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input,
          now: new Date(),
        })
    );
    if (admission?.result.kind !== "accepted") {
      throw new Error("Expected an admitted original.");
    }
    const attemptId = admission.result.attempt.id;
    const completed = await database.transaction(
      async (tx) =>
        await finishMailUndoWithoutEffects({
          attemptId,
          authority,
          database: tx,
          items: [
            {
              code: "undo_changed",
              message: "This mail changed after your action.",
              messageIds: [],
              receiptId: input.receipts[0],
              replayed: false,
              status: "changed",
              threadId: original.threadId,
            },
          ],
        })
    );
    expect(completed).toMatchObject({
      items: [{ status: "changed" }],
      state: "completed",
    });
    const [retained] = await database.transaction(
      async (tx) =>
        await prepareMailUndoRequest({
          authority,
          database: tx,
          input,
          now: new Date(),
        })
    );
    expect(retained?.result).toMatchObject({
      attempt: {
        id: attemptId,
        items: [{ status: "changed" }],
        state: "completed",
      },
      kind: "replay",
    });
    const rows = await database.select().from(mailMessageOperation);
    expect(rows).toHaveLength(1);
  });

  test("observed applied state alone never becomes a logical acknowledgement", async () => {
    const original = await seedOriginal();
    const execution = await capture(original);
    if (execution.progress.kind !== "effects") {
      throw new Error("Expected a retained effect phase.");
    }
    const [phase] = execution.progress.phases;
    if (phase === undefined) {
      throw new Error("Expected the first phase.");
    }
    const nativeId = randomUUID();
    const requestedMessageIds = execution.plan.effects.map(
      (effect) => effect.messageId
    );
    const receipt = mailUndoProgressEventSchema.options[0].shape.receipt.parse({
      actorUserId: authority.actorUserId,
      command: { facet: "read", read: false },
      mailboxId: authority.mailboxId,
      operationId: nativeId,
      owner: "message",
      requestId: phase.requestId,
      requestedMessageIds,
      threadId: original.threadId,
    });
    await database.transaction(async (tx) => {
      await tx.insert(mailMessageOperation).values({
        actorUserId: authority.actorUserId,
        command: receipt.command,
        createdAt: new Date(),
        id: nativeId,
        mailboxId: authority.mailboxId,
        messageIds: requestedMessageIds,
        requestHash: randomUUID(),
        requestId: phase.requestId,
        status: "pending",
        threadId: original.threadId,
        undoProof: {
          attemptId: execution.attempt.id,
          kind: "mail-undo-phase",
          phaseId: phase.id,
        },
        updatedAt: new Date(),
      });
      await transitionMailUndoState({
        attemptId: execution.attempt.id,
        authority,
        database: tx,
        event: { kind: "link", phaseId: phase.id, receipt },
      });
    });
    await database
      .update(mailMessageOperation)
      .set({ status: "applied" })
      .where(eq(mailMessageOperation.id, nativeId));
    const retained = await database.transaction(
      async (tx) =>
        await loadMailUndoExecution({
          attemptId: execution.attempt.id,
          authority,
          database: tx,
        })
    );
    expect(
      projectMailUndoProgress({
        execution: retained,
        replayed: true,
        waitingStatus: "uncertain",
      })
    ).toMatchObject({ items: [{ status: "uncertain" }], state: "uncertain" });
    await database
      .delete(mailMessageOperation)
      .where(eq(mailMessageOperation.id, nativeId));
    await expect(
      database.transaction(
        async (tx) =>
          await transitionMailUndoState({
            attemptId: execution.attempt.id,
            authority,
            database: tx,
            event: { kind: "link", phaseId: phase.id, receipt },
          })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("retains unresolved uncertainty while a neighboring native phase completes", async () => {
    const original = await seedOriginal(2, "destination");
    const execution = await capture(original);
    if (execution.progress.kind !== "effects") {
      throw new Error("Expected retained destination phases.");
    }
    const phases = execution.progress.phases.map((phase) => {
      const effect = execution.plan.effects[phase.effectIndexes[0] ?? -1];
      if (effect?.facet !== "destination") {
        throw new Error("Expected one inverse destination command.");
      }
      const requestedMessageIds = phase.effectIndexes.map((index) => {
        const target = execution.plan.effects[index];
        if (target === undefined) {
          throw new Error("Expected a retained source.");
        }
        return target.messageId;
      });
      return {
        phase,
        receipt: mailUndoProgressEventSchema.options[0].shape.receipt.parse({
          actorUserId: authority.actorUserId,
          command: { destination: effect.destination, facet: effect.facet },
          mailboxId: authority.mailboxId,
          operationId: randomUUID(),
          owner: "message",
          requestId: phase.requestId,
          requestedMessageIds,
          threadId: original.threadId,
        }),
        requestHash: randomUUID(),
      };
    });
    const [first, second] = phases;
    if (phases.length !== 2 || first === undefined || second === undefined) {
      throw new Error("Expected two independent inverse commands.");
    }
    const link = async (entry: (typeof phases)[number]) =>
      await database.transaction(async (tx) => {
        await tx.insert(mailMessageOperation).values({
          actorUserId: authority.actorUserId,
          command: entry.receipt.command,
          createdAt: new Date(),
          id: entry.receipt.operationId,
          mailboxId: authority.mailboxId,
          messageIds: entry.receipt.requestedMessageIds,
          requestHash: entry.requestHash,
          requestId: entry.receipt.requestId,
          status: "pending",
          threadId: original.threadId,
          undoProof: {
            attemptId: execution.attempt.id,
            kind: "mail-undo-phase",
            phaseId: entry.phase.id,
          },
          updatedAt: new Date(),
        });
        return await transitionMailUndoState({
          attemptId: execution.attempt.id,
          authority,
          database: tx,
          event: {
            kind: "link",
            phaseId: entry.phase.id,
            receipt: entry.receipt,
          },
        });
      });
    const acknowledge = async (entry: (typeof phases)[number]) => {
      const { command, requestedMessageIds, ...receipt } = entry.receipt;
      const acknowledgement =
        mailUndoProgressEventSchema.options[1].shape.acknowledgement.parse({
          acknowledgedAt: new Date().toISOString(),
          acknowledgedMessageIds: requestedMessageIds,
          command,
          owner: "message",
          receipt,
          requestedMessageIds,
          status: "acknowledged",
        });
      return await database.transaction(async (tx) => {
        await tx
          .update(mailMessageOperation)
          .set({ status: "applied" })
          .where(eq(mailMessageOperation.id, receipt.operationId));
        return await transitionMailUndoState({
          attemptId: execution.attempt.id,
          authority,
          database: tx,
          event: {
            acknowledgement,
            kind: "acknowledge",
            phaseId: entry.phase.id,
          },
        });
      });
    };
    const linkedFirst = await link(first);
    const uncertainty = projectMailUndoProgress({
      execution: linkedFirst,
      replayed: false,
      waitingStatus: "uncertain",
    });
    await database.transaction(async (tx) => {
      await tx
        .update(mailMessageOperation)
        .set({ status: "submitting" })
        .where(eq(mailMessageOperation.id, first.receipt.operationId));
      await tx
        .update(mailUndoAttempt)
        .set({ items: uncertainty.items, state: uncertainty.state })
        .where(eq(mailUndoAttempt.id, execution.attempt.id));
    });
    const linkedSecond = await link(second);
    const completedSecond = await acknowledge(second);
    expect(linkedSecond.attempt.state).toBe("uncertain");
    expect(completedSecond.attempt).toMatchObject({
      id: execution.attempt.id,
      state: "uncertain",
    });
    expect(completedSecond.attempt.items).toContainEqual(
      expect.objectContaining({
        messageIds: first.receipt.requestedMessageIds,
        status: "uncertain",
      })
    );
    expect(completedSecond.attempt.items).toContainEqual(
      expect.objectContaining({
        messageIds: second.receipt.requestedMessageIds,
        status: "compensated",
      })
    );
    const nativeRows = await database.select().from(mailMessageOperation);
    for (const entry of phases) {
      expect(nativeRows).toContainEqual(
        expect.objectContaining({
          actorUserId: authority.actorUserId,
          id: entry.receipt.operationId,
          mailboxId: authority.mailboxId,
          requestHash: entry.requestHash,
          requestId: entry.phase.requestId,
          status: entry === first ? "submitting" : "applied",
        })
      );
      if (completedSecond.progress.kind !== "effects") {
        throw new Error("Expected the original retained effect phases.");
      }
      expect(
        completedSecond.progress.phases.find(
          (phase) => phase.id === entry.phase.id
        )
      ).toMatchObject({
        id: entry.phase.id,
        intentToken: entry.phase.intentToken,
        native: {
          operationId: entry.receipt.operationId,
          requestId: entry.phase.requestId,
        },
        requestId: entry.phase.requestId,
      });
    }
    const completed = await acknowledge(first);
    expect(completed.attempt.state).toBe("completed");
    expect(completed.attempt.items).toHaveLength(2);
    expect(
      completed.attempt.items.every((item) => item.status === "compensated")
    ).toBeTruthy();
  });

  test("concurrent admission waits on the same mailbox and returns the retained original identity", async () => {
    const original = await seedOriginal();
    const input = mailUndoInputSchema.parse({
      mailboxId: authority.mailboxId,
      receipts: [`message:${original.operationId}`],
    });
    const held = Promise.withResolvers<number>();
    const release = Promise.withResolvers<boolean>();
    const entered = Promise.withResolvers<number>();
    const first = database.transaction(async (tx) => {
      const [{ pid }] = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`
      );
      const result = await prepareMailUndoRequest({
        authority,
        database: tx,
        input,
        now: new Date(),
      });
      held.resolve(pid);
      await release.promise;
      return result;
    });
    const firstPid = await held.promise;
    const second = raceDatabase.transaction(async (tx) => {
      const [{ pid }] = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`
      );
      entered.resolve(pid);
      return await prepareMailUndoRequest({
        authority,
        database: tx,
        input,
        now: new Date(),
      });
    });
    const secondPid = await entered.promise;
    let blockers: number[] = [];
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const [witness] = await raceClient<
          { blockers: number[] }[]
        >`select pg_blocking_pids(${secondPid}) as blockers`;
        blockers = witness?.blockers ?? [];
        if (blockers.includes(firstPid)) {
          break;
        }
      }
      expect(blockers).toContain(firstPid);
    } finally {
      release.resolve(true);
    }
    const [accepted, replayed] = await Promise.all([first, second]);
    expect(accepted[0]?.result.kind).toBe("accepted");
    expect(replayed[0]?.result).toMatchObject({
      attempt:
        accepted[0]?.result.kind === "accepted"
          ? accepted[0].result.attempt
          : null,
      kind: "replay",
    });
    process.stdout.write(
      `${JSON.stringify({ blockers, firstPid, kind: "undo-admission-lock-witness", secondPid })}\n`
    );
  });
});
