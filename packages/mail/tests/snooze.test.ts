import { describe, expect, test } from "vite-plus/test";

import { mailSnoozeApplySchema, mailSnoozeStateSchema } from "../src/snooze";

const schedule = {
  returnAt: "2026-11-01T01:30:00-04:00",
  timeZone: "America/New_York",
};
const request = {
  command: { kind: "snooze", ...schedule },
  mailboxId: "mailbox",
  requestId: crypto.randomUUID(),
  targets: [
    {
      expectedVersion: null,
      messageIds: ["message-b", "message-a", "message-b"],
      threadId: "conversation",
    },
  ],
};

describe("mail snooze input boundaries", () => {
  test("normalizes equivalent anchor and omitted-anchor representations", () => {
    const parsed = mailSnoozeApplySchema.parse(request);
    const equivalent = mailSnoozeApplySchema.parse({
      ...request,
      targets: [
        {
          ...request.targets[0],
          messageIds: ["message-a", "message-b"],
        },
      ],
    });
    expect(parsed.targets).toStrictEqual(equivalent.targets);
    const cancelled = {
      ...request,
      command: { kind: "cancel" },
      targets: [{ expectedVersion: 2, threadId: "conversation" }],
    };
    const omitted = mailSnoozeApplySchema.parse(cancelled);
    const empty = mailSnoozeApplySchema.parse({
      ...cancelled,
      targets: [{ ...cancelled.targets[0], messageIds: [] }],
    });
    expect(omitted.targets).toStrictEqual(empty.targets);
  });

  test("rejects missing anchors and stale-control shapes before lifecycle work", () => {
    for (const invalid of [
      { ...request, targets: [{ expectedVersion: null, threadId: "thread" }] },
      { ...request, command: { kind: "reschedule", ...schedule } },
      { ...request, command: { kind: "return-now" } },
      {
        ...request,
        command: { kind: "cancel", returnAt: schedule.returnAt },
      },
      {
        ...request,
        targets: [{ ...request.targets[0], expectedVersion: -1 }],
      },
    ]) {
      expect(mailSnoozeApplySchema.safeParse(invalid).success).toBeFalsy();
    }
  });

  test("requires an absolute instant and a named time zone", () => {
    expect(mailSnoozeApplySchema.safeParse(request).success).toBeTruthy();
    for (const invalidTime of [
      { returnAt: "2026-11-01T01:30:00", timeZone: schedule.timeZone },
      { returnAt: schedule.returnAt, timeZone: "Not/A_Time_Zone" },
      { returnAt: schedule.returnAt, timeZone: "+01:00" },
    ]) {
      expect(
        mailSnoozeApplySchema.safeParse({
          ...request,
          command: { kind: "snooze", ...invalidTime },
        }).success
      ).toBeFalsy();
    }
  });

  test("rejects repeated conversation identities and aggregate input amplification", () => {
    const repeated = {
      ...request,
      targets: [...request.targets, ...request.targets],
    };
    expect(mailSnoozeApplySchema.safeParse(repeated).success).toBeFalsy();
    const duplicatedAnchors = Array.from({ length: 600 }, () => "message");
    expect(
      mailSnoozeApplySchema.safeParse({
        ...request,
        targets: [
          {
            expectedVersion: null,
            messageIds: duplicatedAnchors,
            threadId: "first",
          },
          {
            expectedVersion: null,
            messageIds: duplicatedAnchors,
            threadId: "second",
          },
        ],
      }).success
    ).toBeFalsy();
    expect(
      mailSnoozeApplySchema.safeParse({
        ...request,
        targets: [{ ...request.targets[0], messageIds: ["x".repeat(8192)] }],
      }).success
    ).toBeFalsy();
  });

  test("keeps execution identity and frozen snapshots outside the public state", () => {
    const state = {
      id: crypto.randomUUID(),
      mailboxId: request.mailboxId,
      ...schedule,
      status: "active",
      threadId: "conversation",
      version: 1,
    };
    expect(mailSnoozeStateSchema.safeParse(state).success).toBeTruthy();
    for (const privateFields of [
      { actorUserId: "actor" },
      { hideRequestId: crypto.randomUUID() },
      { hiddenMessageIds: ["private-message"] },
    ]) {
      expect(
        mailSnoozeStateSchema.safeParse({ ...state, ...privateFields }).success
      ).toBeFalsy();
    }
  });
});
