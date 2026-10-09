import type { gmailAutoLabelEvent } from "@quieter/database/schema";
import type * as drizzleOrm from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  claimAutoLabelEvent,
  reopenEmptyAutoLabelEvent,
} from "../src/mail-automation/auto-label-events";

type AutoLabelEvent = typeof gmailAutoLabelEvent.$inferSelect;
type EventPredicate = (event: AutoLabelEvent) => boolean;
const fixture = vi.hoisted(
  (): { current: AutoLabelEvent | null; updates: number } => ({
    current: null,
    updates: 0,
  })
);

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Evaluate claim predicates against the persisted event, including equal millisecond timestamps.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof drizzleOrm>()),
  and:
    (...predicates: (EventPredicate | undefined)[]) =>
    (event: AutoLabelEvent) =>
      predicates.every(
        (predicate) => typeof predicate !== "function" || predicate(event)
      ),
  eq: (column: { name: string }, value: unknown) => (event: AutoLabelEvent) => {
    const actual = Object.entries(event).find(
      ([name]) => name === column.name
    )?.[1];
    return actual instanceof Date && value instanceof Date
      ? actual.getTime() === value.getTime()
      : actual === value;
  },
  isNull: (column: { name: string }) => (event: AutoLabelEvent) =>
    Object.entries(event).find(([name]) => name === column.name)?.[1] === null,
  lte: (column: { name: string }, value: Date) => (event: AutoLabelEvent) => {
    const actual = Object.entries(event).find(
      ([name]) => name === column.name
    )?.[1];
    return actual instanceof Date && actual <= value;
  },
  ne: (column: { name: string }, value: unknown) => (event: AutoLabelEvent) => {
    const actual = Object.entries(event).find(
      ([name]) => name === column.name
    )?.[1];
    return actual !== null && actual !== value;
  },
  or:
    (...predicates: (EventPredicate | undefined)[]) =>
    (event: AutoLabelEvent) =>
      predicates.some((predicate) => predicate?.(event) === true),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake stores the actual update so tests exercise decision and billing identity changes.
vi.mock("@quieter/database/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (fixture.current ? [fixture.current] : []),
      }),
    }),
    update: () => ({
      set: (values: Partial<AutoLabelEvent>) => ({
        where: (predicate: EventPredicate) => ({
          returning: () => {
            if (fixture.current === null || !predicate(fixture.current)) {
              return [];
            }
            fixture.current = { ...fixture.current, ...values };
            fixture.updates += 1;
            return [fixture.current];
          },
        }),
      }),
    }),
  },
}));
vi.mock(import("../src/mail-automation/usage"), () => ({
  reportAutoLabelUsage: vi.fn<() => Promise<void>>(),
}));

const completedEvent = (): typeof gmailAutoLabelEvent.$inferSelect => ({
  appliedAt: new Date(),
  attemptCount: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  completionTokens: 10,
  costUsd: 0.01,
  createdAt: new Date(),
  gmailMessageId: "message-1",
  id: "old-usage",
  labelIds: [],
  lastError: null,
  mailboxId: "mailbox-1",
  model: "model",
  nextAttemptAt: null,
  promptTokens: 20,
  updatedAt: new Date(),
  usageReportedAt: new Date(),
});

describe("retrying old empty automatic labeling decisions", () => {
  beforeEach(() => {
    fixture.current = null;
    fixture.updates = 0;
  });

  test("retains completed nonempty decisions", async () => {
    const event = { ...completedEvent(), labelIds: ["manual-label"] };
    await expect(reopenEmptyAutoLabelEvent(event, "owner")).resolves.toBe(
      event
    );
  });

  test("refuses to replace unreported prior usage", async () => {
    const event = { ...completedEvent(), usageReportedAt: null };
    fixture.current = event;
    await expect(reopenEmptyAutoLabelEvent(event, "owner")).rejects.toThrow(
      /usage could not be recorded/u
    );
    expect(fixture.updates).toBe(0);
  });

  test("returns a fresh decision identity after prior usage is acknowledged", async () => {
    const event = completedEvent();
    fixture.current = event;
    const reopened = await reopenEmptyAutoLabelEvent(event, "owner");
    expect(reopened.id).not.toBe(event.id);
    expect(reopened.appliedAt).toBeNull();
    expect(reopened.labelIds).toBeNull();
    expect(reopened.costUsd).toBeNull();
    expect(reopened.usageReportedAt).toBeNull();
  });

  test("rejects another active lease even when its timestamp matches the original event", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const event = { ...completedEvent(), appliedAt: null, labelIds: null };
      fixture.current = event;
      const claimed = await claimAutoLabelEvent(event, true);
      expect(claimed?.updatedAt.getTime()).toBe(event.updatedAt.getTime());
      await expect(claimAutoLabelEvent(event, true)).resolves.toBeUndefined();
      expect(fixture.updates).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
