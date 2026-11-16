import { mailUndoInputSchema, mailUndoItemSchema } from "@quieter/mail/undo";
import { describe, expect, test } from "vite-plus/test";

import {
  admitMailUndo,
  createMailUndoCutoff,
  getMailUndoReceipt,
  mailUndoAdmissionSchema,
  mailUndoAttemptSchema,
  mailUndoOriginalSchema,
  mailUndoPlanningSchema,
  planMailUndo,
} from "../src/mail/undo-model";
import type { MailUndoOriginal } from "../src/mail/undo-model";

const operationId = "00000000-0000-4000-8000-000000000001";
const intentToken = "00000000-0000-4000-8000-000000000002";
const phaseId = "00000000-0000-4000-8000-000000000003";
const attemptId = "00000000-0000-4000-8000-000000000004";
const scheduleId = "00000000-0000-4000-8000-000000000005";
const newerIntent = "00000000-0000-4000-8000-000000000006";
const admittedAt = "2026-11-16T12:00:00.000Z";
const now = "2026-11-16T12:00:01.000Z";
const authority = {
  actorUserId: "actor",
  canWrite: true,
  mailboxId: "mailbox",
};
const originalFields = {
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
  messageId: "message",
  outcome: {
    proof: { kind: "managed-revision", revision: "90071992547409931234" },
    status: "acknowledged",
  },
  phaseId,
};
const destinationEffect = {
  ...readEffect,
  after: { kind: "managed", value: "done" },
  before: { kind: "managed", value: "inbox" },
  facet: "destination",
};
const currentMessage = {
  destination: { kind: "managed", value: "done" },
  destinationIntentToken: intentToken,
  mailboxId: "mailbox",
  messageId: "message",
  read: true,
  readIntentToken: intentToken,
  source: {
    destinationRevision: "90071992547409931234",
    kind: "managed-revision",
    readRevision: "90071992547409931234",
  },
  threadId: "thread",
};

const messageOriginal = (effects: unknown[] = [readEffect]): MailUndoOriginal =>
  mailUndoOriginalSchema.parse({
    ...originalFields,
    kind: "message",
    proof: { effects },
  });

const admission = (original: MailUndoOriginal) =>
  mailUndoAdmissionSchema.parse({
    actorUserId: "actor",
    attemptId,
    authority,
    existingAttempt: null,
    mailboxId: "mailbox",
    now,
    original,
    receiptId: `${original.kind}:${original.operationId}`,
  });

const planning = (original: MailUndoOriginal) => {
  const accepted = admitMailUndo(admission(original));
  if (accepted.kind !== "accepted") {
    throw new Error("The fixture must admit an inverse.");
  }
  const schedule = original.kind === "snooze" ? original.proof?.after : null;
  const returning =
    original.kind === "snooze" && original.proof?.command === "return-now";
  return mailUndoPlanningSchema.parse({
    actorUserId: "actor",
    attempt: accepted.attempt,
    authority,
    currentMessages: [
      {
        ...currentMessage,
        destination: { kind: "managed", value: returning ? "inbox" : "done" },
      },
    ],
    currentSchedule: schedule
      ? {
          incomingMessageIds: schedule.knownIncomingMessageIds,
          mailboxId: "mailbox",
          schedule,
          threadId: "thread",
        }
      : null,
    latestPlacementSequence: "90071992547409931234",
    mailboxId: "mailbox",
    now,
    original,
  });
};

const snoozeOriginal = (
  command: "snooze" | "reschedule" | "cancel" | "return-now",
  previousStatus: "active" | "suspended" = "active",
  previousReturnAt = "2026-11-16T12:30:00.000Z"
): MailUndoOriginal => {
  const previous = {
    hiddenMessageIds: ["message"],
    hideOperationId: phaseId,
    id: scheduleId,
    knownIncomingMessageIds: ["message"],
    returnAt: previousReturnAt,
    status: previousStatus,
    timeZone: "Europe/London",
    version: "90071992547409931231",
  };
  const after = {
    ...previous,
    returnAt:
      command === "reschedule" ? "2026-11-16T13:00:00.000Z" : previous.returnAt,
    status: {
      cancel: "cancelled",
      reschedule: "active",
      "return-now": "returned",
      snooze: previousStatus,
    }[command],
    version: "90071992547409931232",
  };
  const common = { after, command, completion: "acknowledged" };
  let proof;
  if (command === "snooze") {
    proof = { ...common, effects: [destinationEffect] };
  } else if (command === "return-now") {
    proof = {
      ...common,
      effects: [
        {
          ...destinationEffect,
          after: destinationEffect.before,
          before: destinationEffect.after,
        },
      ],
      previous,
    };
  } else {
    proof = {
      ...common,
      guards: [{ ...destinationEffect, before: destinationEffect.after }],
      previous,
    };
  }
  return mailUndoOriginalSchema.parse({
    ...originalFields,
    cutoff: createMailUndoCutoff({
      admittedAt,
      previousReturnAt: command === "snooze" ? null : previousReturnAt,
    }),
    kind: "snooze",
    proof,
  });
};

describe("Undo public boundary", () => {
  test("accepts only opaque originals, deduplicates retries, and rejects forged authority or inverse payloads", () => {
    const request = {
      mailboxId: "mailbox",
      receipts: [`message:${operationId}`, `message:${operationId}`],
    };
    expect(mailUndoInputSchema.parse(request).receipts).toHaveLength(1);
    expect(
      mailUndoInputSchema.safeParse({ ...request, actorUserId: "other" })
        .success
    ).toBeFalsy();
    expect(
      mailUndoInputSchema.safeParse({
        ...request,
        before: false,
        messageIds: ["message"],
      }).success
    ).toBeFalsy();
    expect(
      mailUndoInputSchema.safeParse({
        ...request,
        receipts: [`read:${operationId}`],
      }).success
    ).toBeFalsy();
    expect(
      mailUndoInputSchema.safeParse({
        ...request,
        receipts: ["message:forged"],
      }).success
    ).toBeFalsy();
    expect(
      mailUndoInputSchema.safeParse({
        ...request,
        receipts: Array.from({ length: 1001 }, () => request.receipts[0]),
      }).success
    ).toBeFalsy();
  });

  test("requires a usable explanation for every unsuccessful item", () => {
    const item = {
      messageIds: [],
      receiptId: `message:${operationId}`,
      replayed: false,
      threadId: "thread",
    };
    expect(
      mailUndoItemSchema.safeParse({ ...item, status: "denied" }).success
    ).toBeFalsy();
    expect(
      mailUndoItemSchema.safeParse({ ...item, status: "unchanged" }).success
    ).toBeTruthy();
    expect(
      mailUndoItemSchema.safeParse({
        ...item,
        code: "undo_denied",
        message: "This action is unavailable.",
        status: "denied",
        threadId: null,
      }).success
    ).toBeTruthy();
    expect(
      mailUndoItemSchema.safeParse({
        ...item,
        status: "compensated",
        threadId: null,
      }).success
    ).toBeFalsy();
  });
});

describe("Undo admission and durable identity", () => {
  test("binds actor, mailbox, current authority, and exact original reference", () => {
    const input = admission(messageOriginal());
    expect(
      admitMailUndo({
        ...input,
        actorUserId: "other",
        authority: { ...authority, actorUserId: "other" },
      })
    ).toMatchObject({ kind: "blocked" });
    expect(
      admitMailUndo({
        ...input,
        authority: { ...authority, mailboxId: "other" },
        mailboxId: "other",
      })
    ).toMatchObject({ kind: "blocked" });
    expect(
      admitMailUndo({ ...input, authority: { ...authority, canWrite: false } })
    ).toMatchObject({ kind: "blocked", reason: "denied" });
    expect(
      admitMailUndo({ ...input, receiptId: `placement:${operationId}` })
    ).toMatchObject({ kind: "blocked" });
  });

  test("retains one logical inverse after expiry and predecessor deletion without replaying across scopes", () => {
    const input = admission(messageOriginal());
    const accepted = admitMailUndo(input);
    expect(accepted.kind).toBe("accepted");
    if (accepted.kind !== "accepted") {
      throw new Error("Expected accepted inverse.");
    }
    const later = { ...input, now: "2026-11-16T12:01:00.000Z" };
    expect(admitMailUndo(later)).toMatchObject({
      kind: "blocked",
      reason: "expired",
    });
    const retained = mailUndoAttemptSchema.parse({
      ...accepted.attempt,
      liveOriginalOperationId: null,
    });
    const replay = { ...later, existingAttempt: retained, original: null };
    expect(admitMailUndo(replay)).toMatchObject({
      attempt: { id: accepted.attempt.id },
      kind: "replay",
    });
    expect(
      admitMailUndo({
        ...replay,
        actorUserId: "other",
        authority: { ...authority, actorUserId: "other" },
      })
    ).toMatchObject({ kind: "blocked", reason: "denied" });
    expect(
      admitMailUndo({
        ...replay,
        authority: { ...authority, mailboxId: "other" },
        mailboxId: "other",
      })
    ).toMatchObject({ kind: "blocked", reason: "denied" });
  });

  test("does not infer acknowledgement from matching source state or historical receipts", () => {
    const observed = messageOriginal([
      { ...readEffect, outcome: { status: "observed-applied" } },
    ]);
    const historical = mailUndoOriginalSchema.parse({
      ...messageOriginal(),
      proof: null,
    });
    expect(getMailUndoReceipt({ now, original: observed })).toBeNull();
    expect(getMailUndoReceipt({ now, original: historical })).toBeNull();
    expect(admitMailUndo(admission(observed))).toMatchObject({
      kind: "blocked",
      reason: "unavailable",
    });
  });

  test("keeps the original admission cutoff immutable and rejects unnormalized revisions", () => {
    const original = messageOriginal();
    expect(
      mailUndoOriginalSchema.safeParse({
        ...original,
        cutoff: "2026-11-16T13:00:00.000Z",
      }).success
    ).toBeFalsy();
    expect(
      mailUndoOriginalSchema.safeParse({
        ...original,
        proof: {
          effects: [
            {
              ...readEffect,
              outcome: {
                proof: { kind: "managed-revision", revision: "01" },
                status: "acknowledged",
              },
            },
          ],
        },
      }).success
    ).toBeFalsy();
  });

  test.each(["message", "placement", "snooze"] as const)(
    "rejects malformed stored %s timestamps before semantic conversion",
    (kind) => {
      const original =
        kind === "snooze"
          ? snoozeOriginal("snooze")
          : mailUndoOriginalSchema.parse({
              ...originalFields,
              kind,
              proof: null,
            });
      for (const field of ["admittedAt", "cutoff"] as const) {
        expect(
          mailUndoOriginalSchema.safeParse({
            ...original,
            [field]: "not-a-date",
          }).success
        ).toBeFalsy();
      }
    }
  );

  test("rejects malformed stored inverse admission timestamps", () => {
    const accepted = admitMailUndo(admission(messageOriginal()));
    if (accepted.kind !== "accepted") {
      throw new Error("Expected an accepted inverse.");
    }
    for (const field of ["admittedAt", "cutoff"] as const) {
      expect(
        mailUndoAttemptSchema.safeParse({
          ...accepted.attempt,
          [field]: "not-a-date",
        }).success
      ).toBeFalsy();
    }
  });
});

describe("exact compensation ownership", () => {
  test("retains selected no-ops while compensating only the acknowledged changed subset", () => {
    const original = messageOriginal([
      readEffect,
      {
        ...readEffect,
        before: true,
        messageId: "already-read",
        outcome: { status: "unchanged" },
      },
      {
        ...readEffect,
        messageId: "unknown",
        outcome: { status: "submitting" },
      },
    ]);
    const result = planMailUndo(planning(original));
    expect(result.plan?.effects).toMatchObject([
      { messageId: "message", read: false },
    ]);
    expect(result.plan?.effects).toHaveLength(1);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        messageIds: ["already-read"],
        status: "unchanged",
      })
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({ messageIds: ["unknown"], status: "uncertain" })
    );
    expect(getMailUndoReceipt({ now, original })).not.toBeNull();
  });

  test("a no-op still carries intent evidence and never creates an offer by itself", () => {
    const original = messageOriginal([
      { ...readEffect, before: true, outcome: { status: "unchanged" } },
    ]);
    expect(getMailUndoReceipt({ now, original })).toBeNull();
    expect(
      mailUndoOriginalSchema.safeParse({
        ...original,
        proof: {
          effects: [
            {
              ...readEffect,
              before: true,
              intentToken: undefined,
              outcome: { status: "unchanged" },
            },
          ],
        },
      }).success
    ).toBeFalsy();
  });

  test.each([
    { destinationIntentToken: newerIntent },
    {
      source: {
        ...currentMessage.source,
        destinationRevision: "90071992547409931235",
      },
    },
    { threadId: "another-thread" },
    { mailboxId: "another-mailbox" },
  ])(
    "rejects a newer destination intent, native ABA, or reassociated resource %o",
    (change) => {
      const input = planning(messageOriginal([destinationEffect]));
      const result = planMailUndo(
        mailUndoPlanningSchema.parse({
          ...input,
          currentMessages: [{ ...currentMessage, ...change }],
        })
      );
      expect(result.plan).toBeNull();
      expect(result.items).toMatchObject([{ status: "changed" }]);
    }
  );

  test("keeps read and destination revisions independent and rechecks authority before work", () => {
    const input = planning(messageOriginal());
    const changedDestination = {
      ...currentMessage,
      destinationIntentToken: newerIntent,
      source: {
        ...currentMessage.source,
        destinationRevision: "90071992547409931235",
      },
    };
    expect(
      planMailUndo(
        mailUndoPlanningSchema.parse({
          ...input,
          currentMessages: [changedDestination],
        })
      ).plan?.effects
    ).toHaveLength(1);
    expect(
      planMailUndo({ ...input, authority: { ...authority, canWrite: false } })
        .plan
    ).toBeNull();
    expect(
      planMailUndo({ ...input, now: "2026-11-16T12:01:00.000Z" }).plan?.effects
    ).toHaveLength(1);
  });

  test("uses the acknowledged Gmail resource history and protected delta without accepting a broad label snapshot", () => {
    const gmailEffect = {
      ...destinationEffect,
      after: { inbox: false, kind: "gmail", spam: true, trash: false },
      before: { inbox: true, kind: "gmail", spam: false, trash: false },
      outcome: {
        proof: {
          acknowledgedAt: admittedAt,
          historyId: "90071992547409931234",
          kind: "gmail-acknowledged-snapshot",
          snapshotAt: now,
        },
        status: "acknowledged",
      },
    };
    const original = messageOriginal([gmailEffect]);
    const input = planning(original);
    const current = {
      ...currentMessage,
      destination: gmailEffect.after,
      source: {
        historyId: "90071992547409931234",
        kind: "gmail-fresh-snapshot",
        observedAt: now,
      },
    };
    const matching = planMailUndo(
      mailUndoPlanningSchema.parse({ ...input, currentMessages: [current] })
    );
    expect(matching.plan?.effects).toMatchObject([
      { destination: gmailEffect.before, messageId: "message" },
    ]);
    expect(
      planMailUndo(
        mailUndoPlanningSchema.parse({
          ...input,
          currentMessages: [
            {
              ...current,
              source: { ...current.source, historyId: "90071992547409931235" },
            },
          ],
        })
      ).plan
    ).toBeNull();
    expect(
      mailUndoOriginalSchema.safeParse({
        ...original,
        proof: {
          effects: [
            {
              ...gmailEffect,
              before: {
                ...gmailEffect.before,
                customLabels: ["private-label"],
              },
            },
          ],
        },
      }).success
    ).toBeFalsy();
  });

  test("Done compensation never expands to untouched or freshly loaded history", () => {
    const original = mailUndoOriginalSchema.parse({
      ...originalFields,
      kind: "placement",
      proof: {
        acceptedSequence: "90071992547409931234",
        effects: [destinationEffect],
      },
    });
    const input = planning(original);
    input.currentMessages.push({
      ...input.currentMessages[0],
      messageId: "untouched-old-message",
    });
    const result = planMailUndo(input);
    expect(result.plan?.effects).toHaveLength(1);
    expect(result.plan?.effects).toMatchObject([{ messageId: "message" }]);
    expect(
      planMailUndo({
        ...input,
        latestPlacementSequence: "90071992547409931235",
      }).plan
    ).toBeNull();
  });

  test("never rebuilds or resends an inverse whose native phase is uncertain", () => {
    const input = planning(messageOriginal());
    const result = planMailUndo(input);
    const attempt = mailUndoAttemptSchema.parse({
      ...input.attempt,
      items: result.items.map((item) => ({
        ...item,
        code: "unknown",
        message: "Await confirmation.",
        status: "uncertain",
      })),
      state: "uncertain",
    });
    expect(planMailUndo({ ...input, attempt })).toMatchObject({
      items: [{ replayed: true, status: "uncertain" }],
      plan: null,
    });
    for (const state of ["submitting", "uncertain", "completed"]) {
      expect(
        mailUndoAttemptSchema.safeParse({ ...attempt, items: [], state })
          .success
      ).toBeFalsy();
    }
  });
});

describe("Snooze semantic restoration", () => {
  test.each(["snooze", "reschedule", "cancel", "return-now"] as const)(
    "rejects malformed stored %s lifecycle evidence before semantic conversion",
    (command) => {
      const original = snoozeOriginal(command);
      if (original.kind !== "snooze" || !original.proof) {
        throw new Error("Expected a Snooze action.");
      }
      const invalidOriginals: unknown[] = [];
      for (const invalid of [
        { returnAt: "not-a-date" },
        { version: "not-a-number" },
      ]) {
        invalidOriginals.push({
          ...original,
          proof: {
            ...original.proof,
            after: { ...original.proof.after, ...invalid },
          },
        });
        if ("previous" in original.proof) {
          invalidOriginals.push({
            ...original,
            proof: {
              ...original.proof,
              previous: { ...original.proof.previous, ...invalid },
            },
          });
        }
      }
      for (const invalid of invalidOriginals) {
        expect(mailUndoOriginalSchema.safeParse(invalid).success).toBeFalsy();
      }
    }
  );

  test.each([false, true])(
    "restores suspension after an authorized reschedule with unchanged deadline %s",
    (unchangedDeadline) => {
      const resumed = snoozeOriginal("reschedule", "suspended");
      if (
        resumed.kind !== "snooze" ||
        resumed.proof?.command !== "reschedule"
      ) {
        throw new Error("Expected a rescheduled Snooze.");
      }
      const original = mailUndoOriginalSchema.parse({
        ...resumed,
        proof: {
          ...resumed.proof,
          after: {
            ...resumed.proof.after,
            returnAt: unchangedDeadline
              ? resumed.proof.previous.returnAt
              : resumed.proof.after.returnAt,
          },
        },
      });
      expect(getMailUndoReceipt({ now, original })).not.toBeNull();
      const result = planMailUndo(planning(original));
      expect(result.plan).toMatchObject({
        effects: [],
        kind: "snooze",
        schedule: { status: "suspended" },
      });
      if (!result.plan || result.plan.kind !== "snooze") {
        throw new Error("Expected a Snooze compensation plan.");
      }
      expect(BigInt(result.plan.nextVersion)).toBeGreaterThan(
        BigInt(result.plan.expectedVersion)
      );
    }
  );

  test("does not offer an inverse for an unchanged active reschedule", () => {
    const rescheduled = snoozeOriginal("reschedule");
    if (
      rescheduled.kind !== "snooze" ||
      rescheduled.proof?.command !== "reschedule"
    ) {
      throw new Error("Expected a rescheduled Snooze.");
    }
    const original = mailUndoOriginalSchema.parse({
      ...rescheduled,
      proof: {
        ...rescheduled.proof,
        after: {
          ...rescheduled.proof.after,
          returnAt: rescheduled.proof.previous.returnAt,
          timeZone: rescheduled.proof.previous.timeZone,
        },
      },
    });
    expect(getMailUndoReceipt({ now, original })).toBeNull();
    expect(admitMailUndo(admission(original))).toMatchObject({
      kind: "blocked",
      reason: "unavailable",
    });
  });

  test.each(["suspended", "cancelled", "returned"])(
    "rejects a fabricated reschedule transition to %s",
    (status) => {
      const original = snoozeOriginal("reschedule");
      if (
        original.kind !== "snooze" ||
        original.proof?.command !== "reschedule"
      ) {
        throw new Error("Expected a rescheduled Snooze.");
      }
      expect(
        mailUndoOriginalSchema.safeParse({
          ...original,
          proof: {
            ...original.proof,
            after: { ...original.proof.after, status },
            previous: { ...original.proof.previous, status: "suspended" },
          },
        }).success
      ).toBeFalsy();
    }
  );

  test.each(["reschedule", "cancel"] as const)(
    "allows %s to retain an older acknowledged hide without claiming a new destination effect",
    (command) => {
      const managedOriginal = snoozeOriginal(command);
      if (
        managedOriginal.kind !== "snooze" ||
        !managedOriginal.proof ||
        !("guards" in managedOriginal.proof)
      ) {
        throw new Error("Expected a schedule-only action.");
      }
      const hidden = { inbox: false, kind: "gmail", spam: false, trash: false };
      const original = mailUndoOriginalSchema.parse({
        ...managedOriginal,
        proof: {
          ...managedOriginal.proof,
          guards: [
            {
              ...destinationEffect,
              after: hidden,
              before: hidden,
              outcome: {
                proof: {
                  acknowledgedAt: "2026-11-16T11:00:00.000Z",
                  historyId: "90071992547409931234",
                  kind: "gmail-acknowledged-snapshot",
                  snapshotAt: "2026-11-16T11:00:01.000Z",
                },
                status: "acknowledged",
              },
            },
          ],
        },
      });
      const input = planning(original);
      const current = {
        ...currentMessage,
        destination: hidden,
        source: {
          historyId: "90071992547409931234",
          kind: "gmail-fresh-snapshot",
          observedAt: now,
        },
      };
      expect(getMailUndoReceipt({ now, original })).not.toBeNull();
      expect(
        planMailUndo(
          mailUndoPlanningSchema.parse({ ...input, currentMessages: [current] })
        )
      ).toMatchObject({ plan: { effects: [], kind: "snooze" } });
      expect(
        planMailUndo(
          mailUndoPlanningSchema.parse({
            ...input,
            currentMessages: [
              {
                ...current,
                source: {
                  ...current.source,
                  historyId: "90071992547409931235",
                },
              },
            ],
          })
        ).plan
      ).toBeNull();
    }
  );

  test.each(["snooze", "reschedule", "cancel", "return-now"] as const)(
    "plans a legal %s inverse with monotonic lifecycle and exact native set",
    (command) => {
      const result = planMailUndo(planning(snoozeOriginal(command)));
      expect(result.plan).toMatchObject({
        expectedVersion: "90071992547409931232",
        kind: "snooze",
        nextVersion: "90071992547409931233",
        scheduleId,
      });
      expect(result.plan?.effects).toHaveLength(
        command === "snooze" || command === "return-now" ? 1 : 0
      );
      expect(result.items).toMatchObject([{ status: "pending" }]);
    }
  );

  test.each(["reschedule", "cancel", "return-now"] as const)(
    "rejects %s restoration after a new reply even without a terminal version change",
    (command) => {
      const input = planning(snoozeOriginal(command));
      if (!input.currentSchedule) {
        throw new Error("Expected current schedule.");
      }
      input.currentSchedule.incomingMessageIds.push("new-reply");
      expect(planMailUndo(input)).toMatchObject({
        items: [{ status: "changed" }],
        plan: null,
      });
    }
  );

  test("bounds admission by the earlier old deadline and refuses late restoration under an already accepted identity", () => {
    const original = snoozeOriginal(
      "cancel",
      "active",
      "2026-11-16T12:00:08.000Z"
    );
    const input = planning(original);
    const later = "2026-11-16T12:00:09.000Z";
    expect(admitMailUndo({ ...admission(original), now: later })).toMatchObject(
      { kind: "blocked", reason: "expired" }
    );
    expect(planMailUndo({ ...input, now: later }).plan).toBeNull();
  });

  test("retains a completed forward receipt after its old schedule deadline without offering a new inverse", () => {
    const original = snoozeOriginal(
      "cancel",
      "active",
      "2026-11-16T11:59:00.000Z"
    );
    expect(getMailUndoReceipt({ now, original })).toBeNull();
    expect(admitMailUndo(admission(original))).toMatchObject({
      kind: "blocked",
      reason: "expired",
    });
    expect(
      mailUndoAttemptSchema.safeParse({
        actorUserId: "actor",
        admittedAt: now,
        cutoff: original.cutoff,
        id: attemptId,
        items: [],
        liveOriginalOperationId: operationId,
        mailboxId: "mailbox",
        originalKind: "snooze",
        originalOperationId: operationId,
        state: "accepted",
      }).success
    ).toBeFalsy();
  });

  test("preserves suspended authority semantics without restoring old versions or lease state", () => {
    const original = snoozeOriginal("cancel", "suspended");
    const result = planMailUndo(planning(original));
    expect(result.plan).toMatchObject({
      kind: "snooze",
      schedule: { status: "suspended" },
    });
    expect(
      result.plan && "schedule" in result.plan ? result.plan.schedule : null
    ).not.toHaveProperty("version");
    expect(
      mailUndoOriginalSchema.safeParse({
        ...original,
        proof: original.proof && {
          ...original.proof,
          leaseOwner: "old-worker",
        },
      }).success
    ).toBeFalsy();
  });

  test("rejects newer placement after a schedule-only change and rejects fabricated returned sets", () => {
    const input = planning(snoozeOriginal("cancel"));
    input.currentMessages[0] = {
      ...input.currentMessages[0],
      destinationIntentToken: newerIntent,
    };
    expect(planMailUndo(input).plan).toBeNull();
    const original = snoozeOriginal("return-now");
    expect(
      mailUndoOriginalSchema.safeParse({
        ...original,
        proof: original.proof && {
          ...original.proof,
          effects: [{ ...destinationEffect, messageId: "unrelated" }],
        },
      }).success
    ).toBeFalsy();
  });
});
