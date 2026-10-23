import { ORPCError } from "@orpc/server";
import type { DatabaseClient } from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type * as AiMemoryModule from "../src/ai-memory";
import {
  configureDailyBrief,
  dailyBriefInputs,
  getDailyBrief,
  giveDailyBriefFeedback,
  observeDailyBriefItem,
  prepareDailyBrief,
  recordDailyBriefActivity,
  refreshDailyBrief,
} from "../src/daily-brief";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  memoryContext: vi.fn<typeof AiMemoryModule.loadAiAgentContext>(),
  select: vi.fn<DatabaseClient["select"]>(),
  update: vi.fn<DatabaseClient["update"]>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- This fixture mocks only normal context calls, not the overview overload.
vi.mock("../src/ai-memory", async (original) => ({
  ...(await original<typeof AiMemoryModule>()),
  loadAiAgentContext: mocks.memoryContext,
}));
vi.mock(import("../src/mailbox/service"), async (original) => ({
  ...(await original()),
  assertAccessibleMailbox: mocks.access,
}));
vi.mock(import("@quieter/database/client"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property, receiver): unknown {
        if (property === "select") {
          return mocks.select;
        }
        if (property === "update") {
          return mocks.update;
        }
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

const context = { userId: "reader" };
const input = { mailboxId: "inaccessible-mailbox" };

describe("Daily Brief authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
  });

  test("revalidates access before every read, refresh, configuration, or feedback operation", async () => {
    await expect(getDailyBrief({ context, input })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(refreshDailyBrief({ context, input })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(prepareDailyBrief({ context, input })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      recordDailyBriefActivity({ context, input })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      configureDailyBrief({
        context,
        input: {
          ...input,
          enabled: true,
          localTime: "06:00",
          scheduleEnabled: false,
          timeZone: "Europe/Berlin",
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      giveDailyBriefFeedback({
        context,
        input: { ...input, action: "dismiss", itemId: "item" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      observeDailyBriefItem({
        context,
        input: { ...input, action: "open", itemId: "item" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("rejects client-supplied identities, model choices, and generated content", () => {
    for (const extra of [
      { userId: "other" },
      { model: "other" },
      { items: [] },
    ]) {
      expect(
        dailyBriefInputs.refresh.safeParse({ ...input, ...extra }).success
      ).toBeFalsy();
    }
  });
});
