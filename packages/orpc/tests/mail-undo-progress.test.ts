import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vite-plus/test";

import {
  admitMailUndo,
  createMailUndoCutoff,
  mailUndoAdmissionSchema,
  mailUndoOriginalSchema,
  mailUndoPlanningSchema,
  planMailUndo,
} from "../src/mail/undo-model";
import type { MailUndoOriginal } from "../src/mail/undo-model";
import {
  createMailUndoProgress,
  mailUndoExecutionSchema,
  mailUndoProgressEventSchema,
  projectMailUndoProgress,
  transitionMailUndoProgress,
} from "../src/mail/undo-progress";
import type { MailUndoExecution } from "../src/mail/undo-progress";

const operationId = "00000000-0000-4000-8000-000000000001";
const intentToken = "00000000-0000-4000-8000-000000000002";
const hideId = "00000000-0000-4000-8000-000000000003";
const returnId = "00000000-0000-4000-8000-000000000004";
const attemptId = "00000000-0000-4000-8000-000000000005";
const scheduleId = "00000000-0000-4000-8000-000000000006";
const admittedAt = "2026-11-16T12:00:00.000Z";
const now = "2026-11-16T12:00:01.000Z";
const authority = {
  actorUserId: "actor",
  canWrite: true,
  mailboxId: "mailbox",
};
const fields = {
  actorUserId: "actor",
  admittedAt,
  cutoff: createMailUndoCutoff({ admittedAt, previousReturnAt: null }),
  mailboxId: "mailbox",
  operationId,
  threadId: "thread",
};
const readEffect = {
  after: true,
  before: false,
  facet: "read",
  intentToken,
  messageId: "read-message",
  outcome: {
    proof: { kind: "managed-revision", revision: "90071992547409931234" },
    status: "acknowledged",
  },
  phaseId: hideId,
};
const destinationEffect = {
  ...readEffect,
  after: { kind: "managed", value: "inbox" },
  before: { kind: "managed", value: "trash" },
  facet: "destination",
  messageId: "destination-message",
};

const originalMessage = (
  effects: unknown[] = [readEffect, destinationEffect]
) =>
  mailUndoOriginalSchema.parse({
    ...fields,
    kind: "message",
    proof: { effects },
  });

const originalSnooze = (command: "cancel" | "return-now") => {
  const previous = {
    hiddenMessageIds: ["destination-message"],
    hideOperationId: hideId,
    id: scheduleId,
    knownIncomingMessageIds: ["destination-message"],
    returnAt: "2026-11-16T12:30:00.000Z",
    status: "active",
    timeZone: "Europe/London",
    version: "4",
  };
  const after = {
    ...previous,
    status: command === "cancel" ? "cancelled" : "returned",
    version: "5",
  };
  const placementPredecessor = {
    actorUserId: "actor",
    mailboxId: "mailbox",
    operationId: command === "cancel" ? hideId : returnId,
    placement: command === "cancel" ? "done" : "inbox",
    requestId: randomUUID(),
    sequence: "90071992547409931235",
    status: "applied",
    threadId: "thread",
  };
  const effect = {
    ...destinationEffect,
    after: { kind: "managed", value: command === "cancel" ? "done" : "inbox" },
    before: { kind: "managed", value: "done" },
  };
  return mailUndoOriginalSchema.parse({
    ...fields,
    kind: "snooze",
    proof: {
      after,
      command,
      completion: "acknowledged",
      ...(command === "cancel" ? { guards: [effect] } : { effects: [effect] }),
      placementPredecessor,
      previous,
    },
  });
};

const executionFor = (original: MailUndoOriginal = originalMessage()) => {
  const admitted = admitMailUndo(
    mailUndoAdmissionSchema.parse({
      actorUserId: "actor",
      attemptId,
      authority,
      existingAttempt: null,
      mailboxId: "mailbox",
      now,
      original,
      receiptId: `${original.kind}:${original.operationId}`,
    })
  );
  if (admitted.kind !== "accepted" || original.proof === null) {
    throw new Error("Expected an admitted fixture.");
  }
  const effects =
    "effects" in original.proof
      ? original.proof.effects
      : original.proof.guards;
  const planned = planMailUndo(
    mailUndoPlanningSchema.parse({
      actorUserId: "actor",
      attempt: admitted.attempt,
      authority,
      currentMessages: effects.map((effect) => {
        const normalDestination =
          effect.outcome.status === "acknowledged" &&
          effect.outcome.proof.kind === "gmail-acknowledged-snapshot"
            ? { inbox: true, kind: "gmail", spam: false, trash: false }
            : { kind: "managed", value: "inbox" };
        return {
          destination:
            effect.facet === "destination" ? effect.after : normalDestination,
          destinationIntentToken: intentToken,
          mailboxId: "mailbox",
          messageId: effect.messageId,
          read: effect.facet === "read" ? effect.after : false,
          readIntentToken: intentToken,
          source:
            effect.outcome.status === "acknowledged" &&
            effect.outcome.proof.kind === "gmail-acknowledged-snapshot"
              ? {
                  historyId: effect.outcome.proof.historyId,
                  kind: "gmail-fresh-snapshot",
                  observedAt: now,
                }
              : {
                  destinationRevision: "90071992547409931234",
                  kind: "managed-revision",
                  readRevision: "90071992547409931234",
                },
          threadId: "thread",
        };
      }),
      currentSchedule:
        original.kind === "snooze" && original.proof !== null
          ? {
              incomingMessageIds: original.proof.after.knownIncomingMessageIds,
              mailboxId: "mailbox",
              schedule: original.proof.after,
              threadId: "thread",
            }
          : null,
      latestPlacement:
        original.kind === "snooze" ? original.proof.placementPredecessor : null,
      mailboxId: "mailbox",
      now,
      original,
    })
  );
  if (planned.plan === null) {
    throw new Error("Expected a compensation plan.");
  }
  const input = { attempt: admitted.attempt, original, plan: planned.plan };
  return mailUndoExecutionSchema.parse({
    ...input,
    progress: createMailUndoProgress({ ...input, items: planned.items }),
  });
};

const linkEvent = (execution: MailUndoExecution, index = 0) => {
  if (execution.progress.kind !== "effects") {
    throw new Error("Expected native work.");
  }
  const phase = execution.progress.phases[index];
  const effect = execution.plan.effects[phase.effectIndexes[0]];
  const command =
    effect.facet === "read"
      ? { facet: effect.facet, read: effect.read }
      : { destination: effect.destination, facet: effect.facet };
  return mailUndoProgressEventSchema.parse({
    kind: "link",
    phaseId: phase.id,
    receipt: {
      actorUserId: "actor",
      command,
      mailboxId: "mailbox",
      operationId: randomUUID(),
      owner: phase.owner,
      requestId: phase.requestId,
      requestedMessageIds: phase.effectIndexes.map(
        (effectIndex) => execution.plan.effects[effectIndex].messageId
      ),
      threadId: "thread",
    },
  });
};

const linked = (execution: MailUndoExecution, index = 0) => {
  const event = linkEvent(execution, index);
  return {
    event,
    execution: {
      ...execution,
      progress: transitionMailUndoProgress({ event, execution }),
    },
  };
};

const acknowledgeEvent = (execution: MailUndoExecution, index = 0) => {
  if (execution.progress.kind !== "effects") {
    throw new Error("Expected native work.");
  }
  const phase = execution.progress.phases[index];
  if (phase.native === null) {
    throw new Error("Expected a native receipt.");
  }
  const linkedEvent = linkEvent(execution, index);
  if (linkedEvent.kind !== "link") {
    throw new Error("Expected a linked fixture.");
  }
  const common = {
    acknowledgedAt: now,
    acknowledgedMessageIds: linkedEvent.receipt.requestedMessageIds,
    requestedMessageIds: linkedEvent.receipt.requestedMessageIds,
    status: "acknowledged",
  };
  let acknowledgement;
  if (phase.owner === "placement") {
    acknowledgement = {
      ...common,
      owner: "placement",
      receipt: {
        actorUserId: phase.native.actorUserId,
        mailboxId: phase.native.mailboxId,
        operationId: phase.native.operationId,
        placement: "done",
        requestId: phase.native.requestId,
        sequence: "90071992547409931240",
        status: "applied",
        threadId: phase.native.threadId,
      },
    };
  } else {
    acknowledgement = {
      ...common,
      command: linkedEvent.receipt.command,
      owner: "message",
      receipt: phase.native,
    };
  }
  return mailUndoProgressEventSchema.parse({
    acknowledgement,
    kind: "acknowledge",
    phaseId: phase.id,
  });
};

describe("retained Undo progress", () => {
  test("retains the planner's changed neighbor after its eligible phase acknowledges", () => {
    const execution = executionFor(
      originalMessage([
        readEffect,
        {
          ...readEffect,
          intentToken: randomUUID(),
          messageId: "changed-message",
        },
      ])
    );
    const first = linked(execution);
    const settled = {
      ...first.execution,
      progress: transitionMailUndoProgress({
        event: acknowledgeEvent(first.execution),
        execution: first.execution,
      }),
    };
    const projected = projectMailUndoProgress({
      execution: settled,
      replayed: false,
      waitingStatus: "pending",
    });
    expect(projected.items).toContainEqual(
      expect.objectContaining({
        messageIds: ["changed-message"],
        status: "changed",
      })
    );
    expect(projected.items).toContainEqual(
      expect.objectContaining({
        messageIds: ["read-message"],
        status: "compensated",
      })
    );
  });

  test.each(["unchanged", "submitting", "failed"])(
    "preserves a non-dispatched %s outcome across acknowledgement and replay",
    (status) => {
      const execution = executionFor(
        originalMessage([
          readEffect,
          {
            ...readEffect,
            before: status === "unchanged",
            messageId: "omitted-message",
            outcome: { status },
          },
        ])
      );
      const first = linked(execution);
      const settled = {
        ...first.execution,
        progress: transitionMailUndoProgress({
          event: acknowledgeEvent(first.execution),
          execution: first.execution,
        }),
      };
      const expectedStatus = status === "submitting" ? "uncertain" : status;
      for (const replayed of [false, true]) {
        const projected = projectMailUndoProgress({
          execution: settled,
          replayed,
          waitingStatus: "pending",
        });
        expect(projected.items).toHaveLength(2);
        expect(projected.items).toContainEqual(
          expect.objectContaining({
            messageIds: ["omitted-message"],
            replayed,
            status: expectedStatus,
          })
        );
        expect(projected.items).toContainEqual(
          expect.objectContaining({
            messageIds: ["read-message"],
            replayed,
            status: "compensated",
          })
        );
        expect(projected.state).toBe(
          status === "submitting" ? "uncertain" : "completed"
        );
        expect(
          mailUndoExecutionSchema.safeParse({
            ...settled,
            attempt: { ...settled.attempt, ...projected },
          }).success
        ).toBeTruthy();
      }
    }
  );

  test("retains the skipped source when its eligible neighbor later fails", () => {
    const execution = executionFor(
      originalMessage([
        readEffect,
        {
          ...readEffect,
          intentToken: randomUUID(),
          messageId: "changed-message",
        },
      ])
    );
    const first = linked(execution);
    if (first.execution.progress.kind !== "effects") {
      throw new Error("Expected a native inverse phase.");
    }
    const event = mailUndoProgressEventSchema.parse({
      failure: {
        code: "source_lost",
        message: "Refresh this mail.",
        status: "failed",
      },
      kind: "stop",
      phaseId: first.execution.progress.phases[0].id,
    });
    const failed = {
      ...first.execution,
      progress: transitionMailUndoProgress({
        event,
        execution: first.execution,
      }),
    };
    const projected = projectMailUndoProgress({
      execution: failed,
      replayed: true,
      waitingStatus: "pending",
    });
    expect(projected.items).toContainEqual(
      expect.objectContaining({
        messageIds: ["changed-message"],
        replayed: true,
        status: "changed",
      })
    );
    expect(projected.items).toContainEqual(
      expect.objectContaining({
        messageIds: ["read-message"],
        replayed: true,
        status: "failed",
      })
    );
    expect(
      transitionMailUndoProgress({ event, execution: failed })
    ).toStrictEqual(failed.progress);
  });

  test("rejects missing, foreign, overlapping, duplicated and fabricated retained outcomes", () => {
    const execution = executionFor(
      originalMessage([
        readEffect,
        {
          ...readEffect,
          intentToken: randomUUID(),
          messageId: "changed-message",
        },
      ])
    );
    const [retained] = execution.progress.retainedItems;
    const invalid = [
      [],
      [{ ...retained, messageIds: [] }],
      [{ ...retained, messageIds: ["private-source"] }],
      [{ ...retained, messageIds: ["read-message"] }],
      [retained, retained],
      [{ ...retained, messageIds: ["changed-message", "changed-message"] }],
      [{ ...retained, receiptId: `message:${randomUUID()}` }],
      [{ ...retained, threadId: "another-thread" }],
      [{ ...retained, threadId: null }],
      [{ ...retained, replayed: true }],
      [{ ...retained, status: "pending" }],
      [{ ...retained, status: "compensated" }],
      Array.from({ length: 1001 }, () => retained),
    ];
    for (const retainedItems of invalid) {
      expect(
        mailUndoExecutionSchema.safeParse({
          ...execution,
          progress: { ...execution.progress, retainedItems },
        }).success
      ).toBeFalsy();
    }
    const complete = executionFor();
    expect(
      mailUndoExecutionSchema.safeParse({
        ...complete,
        progress: { ...complete.progress, retainedItems: [retained] },
      }).success
    ).toBeFalsy();
  });

  test("captures actual planner outcomes as isolated progress and rejects missing capture items", () => {
    const execution = executionFor(
      originalMessage([
        readEffect,
        {
          ...readEffect,
          intentToken: randomUUID(),
          messageId: "changed-message",
        },
      ])
    );
    const { items } = projectMailUndoProgress({
      execution,
      replayed: false,
      waitingStatus: "pending",
    });
    const progress = createMailUndoProgress({
      attempt: execution.attempt,
      items,
      original: execution.original,
      plan: execution.plan,
    });
    const skipped = items.find((item) => item.status === "changed");
    if (skipped === undefined) {
      throw new Error("Expected a skipped source outcome.");
    }
    skipped.messageIds.push("private-extra");
    expect(
      mailUndoExecutionSchema.safeParse({ ...execution, progress }).success
    ).toBeTruthy();
    expect(() =>
      createMailUndoProgress({
        attempt: execution.attempt,
        items: [],
        original: execution.original,
        plan: execution.plan,
      })
    ).toThrow(Error);
    expect(() =>
      createMailUndoProgress({
        attempt: execution.attempt,
        items,
        original: execution.original,
        plan: execution.plan,
      })
    ).toThrow(Error);
  });

  test("retains captured identities through native linkage and repeated acknowledgement without mutating callers", () => {
    const execution = executionFor();
    const before = structuredClone(execution);
    Object.freeze(execution.progress);
    const first = linked(execution);
    expect(execution).toStrictEqual(before);
    const repeated = transitionMailUndoProgress(first);
    expect(repeated).toStrictEqual(first.execution.progress);
    const event = acknowledgeEvent(first.execution);
    const progress = transitionMailUndoProgress({
      event,
      execution: first.execution,
    });
    const acknowledged = { ...first.execution, progress };
    expect(
      transitionMailUndoProgress({ event, execution: acknowledged })
    ).toStrictEqual(progress);
    expect(
      projectMailUndoProgress({
        execution: acknowledged,
        replayed: true,
        waitingStatus: "pending",
      }).items
    ).toMatchObject([
      { messageIds: ["read-message"], replayed: true, status: "compensated" },
      {
        messageIds: ["destination-message"],
        replayed: true,
        status: "pending",
      },
    ]);
    if (event.kind === "acknowledge") {
      event.acknowledgement.acknowledgedMessageIds.push("private-extra");
    }
    expect(
      mailUndoExecutionSchema.safeParse(acknowledged).success
    ).toBeTruthy();
  });

  test("rejects progress copied across actors, mailboxes, threads or logical originals", () => {
    const execution = executionFor();
    for (const change of [
      { actorUserId: "another" },
      { mailboxId: "another" },
      { threadId: "another" },
      { attemptId: randomUUID() },
      { originalOperationId: randomUUID() },
      { originalKind: "placement" },
    ]) {
      expect(
        mailUndoExecutionSchema.safeParse({
          ...execution,
          progress: {
            ...execution.progress,
            scope: { ...execution.progress.scope, ...change },
          },
        }).success
      ).toBeFalsy();
    }
  });

  test("rejects missing, duplicated, out-of-range or regrouped plan effects and reused phase identities", () => {
    const execution = executionFor();
    if (execution.progress.kind !== "effects") {
      throw new Error("Expected effect phases.");
    }
    const [first, second] = execution.progress.phases;
    const invalid = [
      [],
      [first],
      [first, { ...second, effectIndexes: first.effectIndexes }],
      [{ ...first, effectIndexes: [0, 1] }],
      [{ ...first, effectIndexes: [999] }, second],
      [first, { ...second, id: first.id }],
      [first, { ...second, requestId: first.requestId }],
      [first, { ...second, intentToken }],
    ];
    for (const phases of invalid) {
      expect(
        mailUndoExecutionSchema.safeParse({
          ...execution,
          progress: { ...execution.progress, phases },
        }).success
      ).toBeFalsy();
    }
    expect(
      mailUndoExecutionSchema.safeParse({
        ...execution,
        plan: { ...execution.plan, effects: [] },
      }).success
    ).toBeFalsy();
  });

  test("refuses altered inverse values and source proof from another forward action", () => {
    const execution = executionFor();
    const [read, destination] = execution.plan.effects;
    expect(
      mailUndoExecutionSchema.safeParse({
        ...execution,
        plan: {
          ...execution.plan,
          effects: [{ ...read, read: true }, destination],
        },
      }).success
    ).toBeFalsy();
    expect(
      mailUndoExecutionSchema.safeParse({
        ...execution,
        plan: {
          ...execution.plan,
          effects: [
            {
              ...read,
              sourceProof: { kind: "managed-revision", revision: "99" },
            },
            destination,
          ],
        },
      }).success
    ).toBeFalsy();
  });

  test("native receipt scope, exact command and source set must match before linking", () => {
    const execution = executionFor();
    const event = linkEvent(execution);
    if (event.kind !== "link") {
      throw new Error("Expected link event.");
    }
    for (const change of [
      { actorUserId: "another" },
      { mailboxId: "another" },
      { threadId: "another" },
      { requestId: randomUUID() },
      { owner: "placement" },
      { operationId },
      { operationId: attemptId },
      { operationId: event.phaseId },
      { requestedMessageIds: ["another"] },
      { requestedMessageIds: ["read-message", "extra"] },
      { command: { facet: "read", read: true } },
    ]) {
      expect(() =>
        transitionMailUndoProgress({
          event: mailUndoProgressEventSchema.parse({
            ...event,
            receipt: { ...event.receipt, ...change },
          }),
          execution,
        })
      ).toThrow(Error);
    }
  });

  test("a retained native receipt cannot be replaced or linked to another phase", () => {
    const first = linked(executionFor());
    const replacement = linkEvent(first.execution);
    expect(() =>
      transitionMailUndoProgress({
        event: replacement,
        execution: first.execution,
      })
    ).toThrow(Error);
    const otherPhase = linkEvent(first.execution, 1);
    if (first.event.kind !== "link" || otherPhase.kind !== "link") {
      throw new Error("Expected native fixtures.");
    }
    const copied = mailUndoProgressEventSchema.parse({
      ...otherPhase,
      receipt: {
        ...otherPhase.receipt,
        operationId: first.event.receipt.operationId,
      },
    });
    expect(() =>
      transitionMailUndoProgress({ event: copied, execution: first.execution })
    ).toThrow(Error);
  });

  test("acknowledgement requires exact linked positive native evidence and cannot come from observation", () => {
    const execution = executionFor();
    const first = linked(execution);
    const event = acknowledgeEvent(first.execution);
    expect(() => transitionMailUndoProgress({ event, execution })).toThrow(
      Error
    );
    if (event.kind !== "acknowledge") {
      throw new Error("Expected acknowledgement.");
    }
    for (const status of [
      "applied",
      "observed-applied",
      "submitting",
      "uncertain",
    ]) {
      expect(
        mailUndoProgressEventSchema.safeParse({
          ...event,
          acknowledgement: { ...event.acknowledgement, status },
        }).success
      ).toBeFalsy();
    }
    for (const change of [
      { acknowledgedMessageIds: ["another"] },
      { requestedMessageIds: ["another"] },
      { acknowledgedAt: "2026-11-15T12:00:00.000Z" },
      {
        receipt: {
          ...event.acknowledgement.receipt,
          operationId: randomUUID(),
        },
      },
    ]) {
      expect(() =>
        transitionMailUndoProgress({
          event: mailUndoProgressEventSchema.parse({
            ...event,
            acknowledgement: { ...event.acknowledgement, ...change },
          }),
          execution: first.execution,
        })
      ).toThrow(Error);
    }
  });

  test("settled and missing-receipt outcomes cannot mint a new request or accept a late result", () => {
    const first = linked(executionFor());
    if (first.execution.progress.kind !== "effects") {
      throw new Error("Expected phases.");
    }
    const [phase] = first.execution.progress.phases;
    const event = mailUndoProgressEventSchema.parse({
      failure: {
        code: "native_missing",
        message: "The original action is unavailable.",
        status: "failed",
      },
      kind: "stop",
      phaseId: phase.id,
    });
    const progress = transitionMailUndoProgress({
      event,
      execution: first.execution,
    });
    const stopped = { ...first.execution, progress };
    expect(
      transitionMailUndoProgress({ event, execution: stopped })
    ).toStrictEqual(progress);
    expect(() =>
      transitionMailUndoProgress({
        event: acknowledgeEvent(first.execution),
        execution: stopped,
      })
    ).toThrow(Error);
    expect(() =>
      transitionMailUndoProgress({
        event: linkEvent(first.execution),
        execution: stopped,
      })
    ).toThrow(Error);
    expect(
      projectMailUndoProgress({
        execution: stopped,
        replayed: true,
        waitingStatus: "uncertain",
      })
    ).toMatchObject({
      items: [{ status: "failed" }, { status: "uncertain" }],
      state: "uncertain",
    });
  });

  test("partial acknowledgement and failure keep per-source outcomes without false all-or-nothing success", () => {
    const first = linked(executionFor());
    const acknowledged = {
      ...first.execution,
      progress: transitionMailUndoProgress({
        event: acknowledgeEvent(first.execution),
        execution: first.execution,
      }),
    };
    if (acknowledged.progress.kind !== "effects") {
      throw new Error("Expected phases.");
    }
    const [acknowledgedPhase, second] = acknowledged.progress.phases;
    const progress = transitionMailUndoProgress({
      event: {
        failure: {
          code: "source_changed",
          message: "This mail changed.",
          status: "changed",
        },
        kind: "stop",
        phaseId: second.id,
      },
      execution: acknowledged,
    });
    const projected = projectMailUndoProgress({
      execution: { ...acknowledged, progress },
      replayed: false,
      waitingStatus: "pending",
    });
    expect(projected.state).toBe("completed");
    expect(projected.items).toMatchObject([
      { messageIds: ["read-message"], status: "compensated" },
      { messageIds: ["destination-message"], status: "changed" },
    ]);
    expect(() =>
      transitionMailUndoProgress({
        event: {
          failure: { code: "late", message: "A late error.", status: "failed" },
          kind: "stop",
          phaseId: acknowledgedPhase.id,
        },
        execution: acknowledged,
      })
    ).toThrow(Error);
  });

  test("uncertain native state changes projection without changing retained dispatch identity", () => {
    const first = linked(executionFor());
    const before = structuredClone(first.execution.progress);
    expect(
      projectMailUndoProgress({
        execution: first.execution,
        replayed: false,
        waitingStatus: "uncertain",
      }).state
    ).toBe("uncertain");
    expect(first.execution.progress).toStrictEqual(before);
    expect(
      projectMailUndoProgress({
        execution: first.execution,
        replayed: true,
        waitingStatus: "pending",
      }).state
    ).toBe("submitting");
  });

  test("schedule-only Undo needs its actual scoped committed lifecycle and never creates a native phase", () => {
    const execution = executionFor(originalSnooze("cancel"));
    expect(execution.progress.kind).toBe("schedule");
    if (
      execution.plan.kind !== "snooze" ||
      execution.plan.restoration.kind !== "restore"
    ) {
      throw new Error("Expected restoration.");
    }
    const event = mailUndoProgressEventSchema.parse({
      actorUserId: "actor",
      kind: "complete-schedule",
      mailboxId: "mailbox",
      schedule: {
        ...execution.plan.restoration.schedule,
        version: execution.plan.nextVersion,
      },
      threadId: "thread",
    });
    if (event.kind !== "complete-schedule") {
      throw new Error("Expected a committed schedule fixture.");
    }
    expect(() =>
      transitionMailUndoProgress({
        event: { ...event, mailboxId: "other" },
        execution,
      })
    ).toThrow(Error);
    const progress = transitionMailUndoProgress({ event, execution });
    expect(
      projectMailUndoProgress({
        execution: { ...execution, progress },
        replayed: false,
        waitingStatus: "pending",
      })
    ).toMatchObject({
      items: [{ messageIds: [], status: "compensated" }],
      state: "completed",
    });
    expect(
      transitionMailUndoProgress({
        event,
        execution: { ...execution, progress },
      })
    ).toStrictEqual(progress);
    expect(() =>
      transitionMailUndoProgress({
        event: {
          failure: { code: "late", message: "A late error.", status: "failed" },
          kind: "stop-schedule",
        },
        execution: { ...execution, progress },
      })
    ).toThrow(Error);
  });

  test("rehide completion retains its actual newer placement receipt and rejects nonmonotonic native ownership", () => {
    const first = linked(executionFor(originalSnooze("return-now")));
    const event = acknowledgeEvent(first.execution);
    if (
      event.kind !== "acknowledge" ||
      event.acknowledgement.owner !== "placement"
    ) {
      throw new Error("Expected placement acknowledgement.");
    }
    const stale = mailUndoProgressEventSchema.parse({
      ...event,
      acknowledgement: {
        ...event.acknowledgement,
        receipt: {
          ...event.acknowledgement.receipt,
          sequence: "90071992547409931235",
        },
      },
    });
    expect(() =>
      transitionMailUndoProgress({ event: stale, execution: first.execution })
    ).toThrow(Error);
    const progress = transitionMailUndoProgress({
      event,
      execution: first.execution,
    });
    expect(
      projectMailUndoProgress({
        execution: { ...first.execution, progress },
        replayed: false,
        waitingStatus: "pending",
      })
    ).toMatchObject({ items: [{ status: "compensated" }], state: "completed" });
  });

  test("independent Gmail responses can settle partially without acknowledging a neighboring message", () => {
    const proof = {
      acknowledgedAt: admittedAt,
      historyId: "90071992547409931234",
      kind: "gmail-acknowledged-snapshot",
      snapshotAt: now,
    };
    const execution = executionFor(
      originalMessage([
        { ...readEffect, outcome: { proof, status: "acknowledged" } },
        {
          ...readEffect,
          messageId: "second-read",
          outcome: { proof, status: "acknowledged" },
        },
      ])
    );
    const first = linked(execution);
    const acknowledged = {
      ...first.execution,
      progress: transitionMailUndoProgress({
        event: acknowledgeEvent(first.execution),
        execution: first.execution,
      }),
    };
    expect(
      projectMailUndoProgress({
        execution: acknowledged,
        replayed: false,
        waitingStatus: "uncertain",
      })
    ).toMatchObject({
      items: [
        { messageIds: ["read-message"], status: "compensated" },
        { messageIds: ["second-read"], status: "uncertain" },
      ],
      state: "uncertain",
    });
  });

  test("corrupt persisted native revisions fail parsing without throwing through safeParse", () => {
    const first = linked(executionFor(originalSnooze("return-now")));
    const progress = transitionMailUndoProgress({
      event: acknowledgeEvent(first.execution),
      execution: first.execution,
    });
    if (progress.kind !== "effects") {
      throw new Error("Expected a retained native phase.");
    }
    const [phase] = progress.phases;
    if (
      phase.state !== "acknowledged" ||
      phase.acknowledgement.owner !== "placement"
    ) {
      throw new Error("Expected native acknowledgement.");
    }
    const corrupted = {
      ...first.execution,
      progress: {
        ...progress,
        phases: [
          {
            ...phase,
            acknowledgement: {
              ...phase.acknowledgement,
              receipt: { ...phase.acknowledgement.receipt, sequence: "broken" },
            },
          },
        ],
      },
    };
    expect(() => mailUndoExecutionSchema.safeParse(corrupted)).not.toThrow(
      Error
    );
    expect(mailUndoExecutionSchema.safeParse(corrupted).success).toBeFalsy();
  });

  test("a Snooze inverse cannot link either its completed return or historical hide as a new receipt", () => {
    const execution = executionFor(originalSnooze("return-now"));
    const event = linkEvent(execution);
    if (event.kind !== "link") {
      throw new Error("Expected a native link.");
    }
    for (const oldId of [hideId, returnId]) {
      expect(() =>
        transitionMailUndoProgress({
          event: {
            ...event,
            receipt: { ...event.receipt, operationId: oldId },
          },
          execution,
        })
      ).toThrow(Error);
    }
  });

  test("a completed attempt cannot retain dispatchable waiting work", () => {
    const execution = executionFor();
    const { items } = projectMailUndoProgress({
      execution,
      replayed: false,
      waitingStatus: "pending",
    });
    const completed = {
      ...execution,
      attempt: { ...execution.attempt, items, state: "completed" },
    };
    expect(mailUndoExecutionSchema.safeParse(completed).success).toBeFalsy();
  });

  test("empty or historical attempts cannot capture replacement progress", () => {
    const execution = executionFor();
    expect(() =>
      createMailUndoProgress({
        ...execution,
        attempt: { ...execution.attempt, liveOriginalOperationId: null },
        items: projectMailUndoProgress({
          execution,
          replayed: false,
          waitingStatus: "pending",
        }).items,
      })
    ).toThrow(Error);
    expect(() =>
      createMailUndoProgress({
        ...execution,
        items: projectMailUndoProgress({
          execution,
          replayed: false,
          waitingStatus: "pending",
        }).items,
        plan: { effects: [], kind: "message" },
      })
    ).toThrow(Error);
    if (execution.progress.kind !== "effects") {
      throw new Error("Expected effect phases.");
    }
    const { phases } = execution.progress;
    expect(
      mailUndoExecutionSchema.safeParse({
        ...execution,
        progress: {
          ...execution.progress,
          phases: Array.from({ length: 1001 }, () => phases[0]),
        },
      }).success
    ).toBeFalsy();
  });
});
