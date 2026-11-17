import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import {
  mailbox,
  mailMessageIntent,
  mailPlacementOperation,
  mailSnooze,
  mailSnoozeOperation,
  managedMailMessage,
  organization,
  user,
} from "@quieter/database/schema";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { mailUndoReceiptIdSchema } from "@quieter/mail/undo";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { applyMailPlacement } from "../src/mail/placement";
import {
  admitMailUndo,
  mailUndoAdmissionSchema,
  mailUndoOriginalSchema,
  mailUndoPlanningSchema,
  planMailUndo,
} from "../src/mail/undo-model";
import { getMailUndoOffer } from "../src/mail/undo-state";
import type { getAuthorizedManagedMailbox } from "../src/mailbox/access";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import { applyMailSnooze } from "../src/snooze/service";

const fixture = await vi.hoisted(async () => {
  const databaseUrl = process.env.QUIETER_TEST_UNDO_DATABASE_URL;
  if (databaseUrl !== undefined) {
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/quieter_undo_fixture" ||
      url.searchParams.size !== 0
    ) {
      throw new Error(
        "Native Undo effects require the dedicated loopback fixture."
      );
    }
  }
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const client = postgres(
    databaseUrl ?? "postgresql://postgres@127.0.0.1:1/quieter_undo_fixture",
    { connect_timeout: 3, max: 1, onnotice: () => {} }
  );
  return {
    actorUserId: "undo-effects-actor",
    client,
    database: drizzle({ client }),
    enabled: databaseUrl !== undefined,
    mailboxId: "undo-effects-mailbox",
    state: { failPublish: false },
  };
});

vi.mock(import("@quieter/database/client"), () => ({ db: fixture.database }));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<() => void>(),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: async (
    input: Parameters<typeof assertAccessibleMailbox>[0]
  ): Promise<Awaited<ReturnType<typeof assertAccessibleMailbox>>> => {
    if (
      input.userId !== fixture.actorUserId ||
      input.mailboxId !== fixture.mailboxId
    ) {
      throw new ORPCError("FORBIDDEN");
    }
    const [selected] = await fixture.database
      .select({
        contentRevision: mailbox.contentRevision,
        id: mailbox.id,
        organizationId: mailbox.organizationId,
        provider: mailbox.provider,
      })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId));
    if (selected === undefined) {
      throw new ORPCError("NOT_FOUND");
    }
    return {
      ...selected,
      capabilities: getMailboxCapabilities({
        provider: selected.provider,
        role: "responder",
      }),
    };
  },
}));
vi.mock(import("../src/mailbox/access"), () => ({
  getAuthorizedManagedMailbox: async (
    input: Parameters<typeof getAuthorizedManagedMailbox>[0],
    database: Parameters<
      typeof getAuthorizedManagedMailbox
    >[1] = fixture.database
  ): Promise<Awaited<ReturnType<typeof getAuthorizedManagedMailbox>>> => {
    if (
      input.userId !== fixture.actorUserId ||
      input.mailboxId !== fixture.mailboxId
    ) {
      throw new ORPCError("FORBIDDEN");
    }
    const [selected] = await database
      .select({
        contentRevision: mailbox.contentRevision,
        displayName: mailbox.displayName,
        emailAddress: mailbox.emailAddress,
        id: mailbox.id,
        organizationId: mailbox.organizationId,
        ownerUserId: mailbox.managedOwnerUserId,
        provider: mailbox.provider,
      })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId));
    if (selected === undefined) {
      throw new ORPCError("NOT_FOUND");
    }
    return { ...selected, role: "responder" };
  },
}));
vi.mock(import("../src/gmail-request"), () => ({
  callGmail: () => {
    throw new Error("A managed fixture must not call Gmail.");
  },
}));
vi.mock(import("../src/mail-capture"), () => ({
  refreshGmailCapturedMessageMetadata: () => {
    throw new Error("No provider transport is allowed.");
  },
  writeGmailCapturedMessage: () => {
    throw new Error("No provider transport is allowed.");
  },
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: async () => {
    if (fixture.state.failPublish) {
      throw new Error("Synthetic post-commit publication failure.");
    }
    await Promise.resolve();
  },
}));
vi.mock(import("../src/snooze/wake"), () => ({
  requestMailSnoozeWake: async () => await Promise.resolve(false),
}));
vi.mock(import("@quieter/gmail"), async (importOriginal) => {
  const { isGmailServiceError } = await importOriginal();
  return {
    batchModifyMessages: () => {
      throw new Error("No provider transport is allowed.");
    },
    getGmailCaptureMetadata: () => {
      throw new Error("No provider transport is allowed.");
    },
    getGmailMessageThreadAssociations: () => {
      throw new Error("No provider transport is allowed.");
    },
    getGmailThreadMessageCount: () => {
      throw new Error("No provider transport is allowed.");
    },
    getThreadWithDetails: () => {
      throw new Error("No provider transport is allowed.");
    },
    isGmailServiceError,
  };
});

const authority = {
  actorUserId: fixture.actorUserId,
  canWrite: true,
  mailboxId: fixture.mailboxId,
};
const context = { userId: fixture.actorUserId };
const threadId = "undo-effects-thread";

const seedMessage = async (input: {
  id: string;
  state?: "active" | "done";
  createdAt?: number;
}) => {
  const createdAt = new Date(input.createdAt ?? 1);
  await fixture.database.insert(managedMailMessage).values({
    createdAt,
    direction: "inbound",
    from: "sender@example.invalid",
    id: input.id,
    mailboxId: fixture.mailboxId,
    mailboxState: input.state ?? "active",
    providerMessageId: input.id,
    sentAt: createdAt,
    threadId,
    updatedAt: createdAt,
  });
};

describe.skipIf(!fixture.enabled)("full-schema managed Undo evidence", () => {
  beforeEach(async () => {
    await fixture.database
      .delete(organization)
      .where(eq(organization.id, "undo-effects-org"));
    await fixture.database.delete(user).where(eq(user.id, fixture.actorUserId));
    const now = new Date();
    await fixture.database.insert(user).values({
      createdAt: now,
      email: "undo-effects@example.invalid",
      emailVerified: true,
      id: fixture.actorUserId,
      name: "Undo effects fixture",
      updatedAt: now,
    });
    await fixture.database.insert(organization).values({
      createdAt: now,
      id: "undo-effects-org",
      name: "Undo effects fixture",
      slug: "undo-effects-org",
    });
    await fixture.database.insert(mailbox).values({
      accessMode: "shared",
      createdAt: now,
      emailAddress: "undo-effects-inbox@example.invalid",
      id: fixture.mailboxId,
      organizationId: "undo-effects-org",
      provider: "managed",
      updatedAt: now,
    });
    fixture.state.failPublish = false;
  });

  afterAll(async () => {
    await fixture.client.end();
  });

  test("records exact native managed acknowledgement and replays without extending its cutoff or source revision", async () => {
    await seedMessage({ id: "undo-effects-anchor" });
    await fixture.database
      .update(managedMailMessage)
      .set({ destinationRevision: 9_007_199_254_740_993n })
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    const input = {
      command: { kind: "set-placement", placement: "done" },
      mailboxId: fixture.mailboxId,
      requestId: randomUUID(),
      targets: [{ messageIds: ["undo-effects-anchor"], threadId }],
    } satisfies Parameters<typeof applyMailPlacement>[0]["input"];
    const first = await applyMailPlacement({ context, input });
    const [target] = first.targets;
    expect(target?.status).toBe("applied");
    if (!target?.operationId) {
      throw new Error("Expected the actual native placement receipt.");
    }
    const [row] = await fixture.database
      .select()
      .from(mailPlacementOperation)
      .where(eq(mailPlacementOperation.id, target.operationId));
    const original = mailUndoOriginalSchema.parse(row?.undoProof);
    const [nativeSequence] = await fixture.client<{ sequence: string }[]>`
      select sequence::text as sequence from "mailPlacementOperation"
      where id=${target.operationId}
    `;
    const [physical] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    expect(original).toMatchObject({
      actorUserId: fixture.actorUserId,
      kind: "placement",
      mailboxId: fixture.mailboxId,
      operationId: target.operationId,
      proof: {
        acceptedSequence: nativeSequence?.sequence,
        effects: [
          {
            after: { kind: "managed", value: "done" },
            before: { kind: "managed", value: "inbox" },
            outcome: {
              proof: { revision: "9007199254740994" },
              status: "acknowledged",
            },
          },
        ],
      },
    });
    expect(physical?.destinationRevision).toBe(9_007_199_254_740_994n);
    expect(first.undoOffer?.receipts.map((receipt) => receipt.id)).toContain(
      `placement:${target.operationId}`
    );
    const replay = await applyMailPlacement({ context, input });
    expect(replay.targets[0]).toMatchObject({
      operationId: target.operationId,
      replayed: true,
      status: "applied",
    });
    expect(replay.undoOffer?.receipts).toStrictEqual(first.undoOffer?.receipts);
    const [afterReplay] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    expect(afterReplay?.destinationRevision).toBe(
      physical?.destinationRevision
    );
    const [{ count }] = await fixture.client<
      { count: number }[]
    >`select count(*)::integer as count from "mailPlacementOperation" where "mailboxId"=${fixture.mailboxId}`;
    expect(count).toBe(1);
  });

  test("an explicit native no-op fences the old destination owner without changing read ownership or writing the source again", async () => {
    await seedMessage({ id: "undo-effects-anchor" });
    const readToken = randomUUID();
    await fixture.database.insert(mailMessageIntent).values({
      mailboxId: fixture.mailboxId,
      messageId: "undo-effects-anchor",
      readIntentToken: readToken,
      updatedAt: new Date(),
    });
    const first = await applyMailPlacement({
      context,
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [{ messageIds: ["undo-effects-anchor"], threadId }],
      },
    });
    const [before] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    const repeated = await applyMailPlacement({
      context,
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [{ messageIds: ["undo-effects-anchor"], threadId }],
      },
    });
    expect(repeated.targets[0]?.status).toBe("applied");
    expect(repeated.targets[0]?.operationId).not.toBe(
      first.targets[0]?.operationId
    );
    expect(repeated.undoOffer).toBeUndefined();
    const [intent] = await fixture.database
      .select()
      .from(mailMessageIntent)
      .where(eq(mailMessageIntent.messageId, "undo-effects-anchor"));
    const [after] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    expect(intent).toMatchObject({
      destinationIntentToken: repeated.targets[0]?.operationId,
      readIntentToken: readToken,
    });
    expect(after?.destinationRevision).toBe(before?.destinationRevision);
    if (after === undefined || intent === undefined) {
      throw new Error("Expected the actual retained source and intent.");
    }
    const [oldRow] = await fixture.database
      .select()
      .from(mailPlacementOperation)
      .where(
        eq(mailPlacementOperation.id, first.targets[0]?.operationId ?? "")
      );
    const original = mailUndoOriginalSchema.parse(oldRow?.undoProof);
    const admission = admitMailUndo(
      mailUndoAdmissionSchema.parse({
        actorUserId: fixture.actorUserId,
        attemptId: randomUUID(),
        authority,
        existingAttempt: null,
        mailboxId: fixture.mailboxId,
        now: new Date().toISOString(),
        original,
        receiptId: `placement:${original.operationId}`,
      })
    );
    if (admission.kind !== "accepted") {
      throw new Error(
        "Expected the original inverse to remain within its fixed cutoff."
      );
    }
    const [latest] =
      await fixture.client`select id as "operationId", "actorUserId", "mailboxId", "threadId", "requestId", sequence::text as sequence, placement, status from "mailPlacementOperation" where "mailboxId"=${fixture.mailboxId} and "threadId"=${threadId} order by "mailPlacementOperation".sequence desc limit 1`;
    const planning = mailUndoPlanningSchema.parse({
      actorUserId: fixture.actorUserId,
      attempt: admission.attempt,
      authority,
      currentMessages: [
        {
          destination: { kind: "managed", value: "done" },
          destinationIntentToken: intent.destinationIntentToken,
          mailboxId: after.mailboxId,
          messageId: after.id,
          read: after.isRead,
          readIntentToken: intent.readIntentToken,
          source: {
            destinationRevision: after.destinationRevision.toString(),
            kind: "managed-revision",
            readRevision: after.readRevision.toString(),
          },
          threadId: after.threadId,
        },
      ],
      currentSchedule: null,
      latestPlacement: latest,
      mailboxId: fixture.mailboxId,
      now: new Date().toISOString(),
      original,
    });
    expect(planMailUndo(planning)).toMatchObject({
      items: [{ status: "changed" }],
      plan: null,
    });
  });

  test("partial bulk failure keeps the acknowledged neighbor's offer", async () => {
    await seedMessage({ id: "undo-effects-anchor" });
    const result = await applyMailPlacement({
      context,
      input: {
        command: { kind: "set-placement", placement: "done" },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          { messageIds: ["undo-effects-anchor"], threadId },
          {
            messageIds: ["undo-effects-missing"],
            threadId: "undo-effects-missing-thread",
          },
        ],
      },
    });
    expect(result.targets).toContainEqual(
      expect.objectContaining({ status: "applied", threadId })
    );
    expect(result.targets).toContainEqual(
      expect.objectContaining({
        status: "failed",
        threadId: "undo-effects-missing-thread",
      })
    );
    const applied = result.targets.find(
      (target) => target.status === "applied"
    );
    expect(result.undoOffer?.receipts.map((receipt) => receipt.id)).toContain(
      `placement:${applied?.operationId ?? ""}`
    );
    const [physical] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    expect(physical?.mailboxState).toBe("done");
  });

  test("managed Snooze, Reschedule and Cancel keep their real hide owner and semantic prior deadline", async () => {
    await seedMessage({ id: "undo-effects-outside", state: "done" });
    await seedMessage({ createdAt: 2, id: "undo-effects-anchor" });
    const returnAt = new Date(Date.now() + 60_000).toISOString();
    const firstInput = {
      command: { kind: "snooze", returnAt, timeZone: "Europe/London" },
      mailboxId: fixture.mailboxId,
      requestId: randomUUID(),
      targets: [
        {
          expectedVersion: null,
          messageIds: ["undo-effects-anchor"],
          threadId,
        },
      ],
    } satisfies Parameters<typeof applyMailSnooze>[0]["input"];
    const first = await applyMailSnooze({ context, input: firstInput });
    const [hidden] = first.targets;
    if (
      !hidden?.operationId ||
      !hidden.placementOperationId ||
      !hidden.snooze
    ) {
      throw new Error("Expected the actual hide and Snooze journal linkage.");
    }
    expect(first.undoOffer?.receipts.map((receipt) => receipt.id)).toContain(
      `snooze:${hidden.operationId}`
    );
    const direct = await getMailUndoOffer({
      authority,
      database: fixture.database,
      now: new Date(),
      receiptIds: [
        mailUndoReceiptIdSchema.parse(
          `placement:${hidden.placementOperationId}`
        ),
      ],
    });
    expect(direct).toBeNull();
    const replay = await applyMailSnooze({ context, input: firstInput });
    expect(replay.targets[0]).toMatchObject({
      operationId: hidden.operationId,
      replayed: true,
      status: "applied",
    });
    expect(replay.undoOffer?.receipts).toStrictEqual(first.undoOffer?.receipts);
    const rescheduled = await applyMailSnooze({
      context,
      input: {
        command: {
          kind: "reschedule",
          returnAt: new Date(Date.now() + 120_000).toISOString(),
          timeZone: "Europe/Paris",
        },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          { expectedVersion: hidden.snooze.version, messageIds: [], threadId },
        ],
      },
    });
    const [changed] = rescheduled.targets;
    if (!changed?.operationId || !changed.snooze) {
      throw new Error("Expected the actual reschedule journal.");
    }
    const [rescheduleRow] = await fixture.database
      .select()
      .from(mailSnoozeOperation)
      .where(eq(mailSnoozeOperation.id, changed.operationId));
    const rescheduleOriginal = mailUndoOriginalSchema.parse(
      rescheduleRow?.undoProof
    );
    expect(rescheduleOriginal).toMatchObject({
      kind: "snooze",
      proof: {
        command: "reschedule",
        placementPredecessor: { operationId: hidden.placementOperationId },
        previous: { hideOperationId: hidden.placementOperationId, returnAt },
      },
    });
    expect(
      rescheduled.undoOffer?.receipts.map((receipt) => receipt.id)
    ).toContain(`snooze:${changed.operationId}`);
    const cancelled = await applyMailSnooze({
      context,
      input: {
        command: { kind: "cancel" },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          { expectedVersion: changed.snooze.version, messageIds: [], threadId },
        ],
      },
    });
    const [cancel] = cancelled.targets;
    if (!cancel?.operationId) {
      throw new Error("Expected the actual Cancel journal.");
    }
    const [cancelRow] = await fixture.database
      .select()
      .from(mailSnoozeOperation)
      .where(eq(mailSnoozeOperation.id, cancel.operationId));
    const cancelOriginal = mailUndoOriginalSchema.parse(cancelRow?.undoProof);
    expect(cancelOriginal).toMatchObject({
      kind: "snooze",
      proof: {
        command: "cancel",
        placementPredecessor: { operationId: hidden.placementOperationId },
        previous: { returnAt: changed.snooze.returnAt, status: "active" },
      },
    });
    expect(
      cancelled.undoOffer?.receipts.map((receipt) => receipt.id)
    ).toContain(`snooze:${cancel.operationId}`);
    const [outside] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-outside"));
    expect(outside?.mailboxState).toBe("done");
  });

  test("Return now binds its actual return receipt and keeps the saved active schedule as prior semantics", async () => {
    await seedMessage({ id: "undo-effects-anchor" });
    const first = await applyMailSnooze({
      context,
      input: {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "Europe/London",
        },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: null,
            messageIds: ["undo-effects-anchor"],
            threadId,
          },
        ],
      },
    });
    const [hidden] = first.targets;
    if (!hidden?.snooze) {
      throw new Error("Expected the actual active Snooze.");
    }
    const returned = await applyMailSnooze({
      context,
      input: {
        command: { kind: "return-now" },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          { expectedVersion: hidden.snooze.version, messageIds: [], threadId },
        ],
      },
    });
    const [target] = returned.targets;
    if (!target?.operationId || !target.placementOperationId) {
      throw new Error("Expected the actual return receipt.");
    }
    const [row] = await fixture.database
      .select()
      .from(mailSnoozeOperation)
      .where(eq(mailSnoozeOperation.id, target.operationId));
    const original = mailUndoOriginalSchema.parse(row?.undoProof);
    expect(original).toMatchObject({
      kind: "snooze",
      proof: {
        command: "return-now",
        placementPredecessor: {
          operationId: target.placementOperationId,
          placement: "inbox",
        },
        previous: {
          hideOperationId: hidden.placementOperationId,
          returnAt: hidden.snooze.returnAt,
          status: "active",
        },
      },
    });
    expect(target.placementOperationId).not.toBe(hidden.placementOperationId);
    expect(returned.undoOffer?.receipts.map((receipt) => receipt.id)).toContain(
      `snooze:${target.operationId}`
    );
    const [schedule] = await fixture.database
      .select()
      .from(mailSnooze)
      .where(eq(mailSnooze.mailboxId, fixture.mailboxId));
    expect(schedule).toMatchObject({
      returnOperationId: target.placementOperationId,
      status: "returned",
    });
  });

  test("an optional publication failure preserves the acknowledged managed Snooze and its offer", async () => {
    await seedMessage({ id: "undo-effects-anchor" });
    fixture.state.failPublish = true;
    const result = await applyMailSnooze({
      context,
      input: {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "Europe/London",
        },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: null,
            messageIds: ["undo-effects-anchor"],
            threadId,
          },
        ],
      },
    });
    expect(result.targets[0]?.status).toBe("applied");
    expect(result.undoOffer?.receipts).toHaveLength(1);
    const [physical] = await fixture.database
      .select()
      .from(managedMailMessage)
      .where(eq(managedMailMessage.id, "undo-effects-anchor"));
    expect(physical?.mailboxState).toBe("done");
    const [{ count }] = await fixture.database
      .select({ count: sql<number>`count(*)::integer` })
      .from(mailSnooze)
      .where(eq(mailSnooze.mailboxId, fixture.mailboxId));
    expect(count).toBe(1);
  });

  test("a partially converged Return now succeeds without manufacturing an inverse for untouched sources", async () => {
    await seedMessage({ id: "undo-effects-earlier" });
    await seedMessage({ createdAt: 2, id: "undo-effects-anchor" });
    const first = await applyMailSnooze({
      context,
      input: {
        command: {
          kind: "snooze",
          returnAt: new Date(Date.now() + 60_000).toISOString(),
          timeZone: "Europe/London",
        },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          {
            expectedVersion: null,
            messageIds: ["undo-effects-anchor"],
            threadId,
          },
        ],
      },
    });
    const [hidden] = first.targets;
    if (!hidden?.snooze) {
      throw new Error("Expected an actual hidden source set.");
    }
    await fixture.database
      .update(managedMailMessage)
      .set({ mailboxState: "active", updatedAt: new Date() })
      .where(eq(managedMailMessage.id, "undo-effects-earlier"));
    const returned = await applyMailSnooze({
      context,
      input: {
        command: { kind: "return-now" },
        mailboxId: fixture.mailboxId,
        requestId: randomUUID(),
        targets: [
          { expectedVersion: hidden.snooze.version, messageIds: [], threadId },
        ],
      },
    });
    expect(returned.targets[0]).toMatchObject({ status: "applied" });
    expect(returned.undoOffer).toBeUndefined();
    const rows = await fixture.database
      .select({ mailboxState: managedMailMessage.mailboxState })
      .from(managedMailMessage)
      .where(eq(managedMailMessage.mailboxId, fixture.mailboxId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.mailboxState === "active")).toBeTruthy();
  });
});
