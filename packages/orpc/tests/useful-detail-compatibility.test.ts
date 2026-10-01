import { ORPCError } from "@orpc/server";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  listGmailThreadUsefulDetails,
  listGmailUsefulDetails,
  setGmailUsefulDetails,
} from "../src/gmail-useful-details/compatibility";
import type { assertOwnedGmailMailbox } from "../src/mailbox/access";
import type {
  assertAccessibleMailbox,
  getAuthorizedManagedMailbox,
} from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  accessible: vi.fn<typeof assertAccessibleMailbox>(),
  conflictValues: [] as Record<string, unknown>[],
  insertedValues: [] as Record<string, unknown>[],
  managed: vi.fn<typeof getAuthorizedManagedMailbox>(),
  owned: vi.fn<typeof assertOwnedGmailMailbox>(),
}));

// This fake implements only the insert operations exercised by the test.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.insertedValues.push(values);
        return {
          onConflictDoUpdate: (options: { set: Record<string, unknown> }) => {
            mocks.conflictValues.push(options.set);
          },
        };
      },
    }),
  },
}));
vi.mock(import("../src/mailbox/access"), () => ({
  assertOwnedGmailMailbox: mocks.owned,
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: mocks.accessible,
  getAuthorizedManagedMailbox: mocks.managed,
}));

const mailboxId = "mailbox-1";
const userId = "user-1";

describe("legacy useful-detail RPC compatibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.insertedValues.length = 0;
    mocks.conflictValues.length = 0;
    mocks.accessible.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: mailboxId,
      organizationId: "organization-1",
      provider: "gmail",
    });
  });

  test("returns disabled results for an owned Gmail mailbox", async () => {
    await expect(
      listGmailUsefulDetails({ mailboxId, userId })
    ).resolves.toMatchObject({
      enabled: false,
      items: [],
      nextRelevantAt: null,
    });
    await expect(
      listGmailThreadUsefulDetails({
        gmailThreadId: "thread-1",
        mailboxId,
        userId,
      })
    ).resolves.toStrictEqual([]);
    expect(mocks.owned).toHaveBeenCalledWith({ mailboxId, userId });
  });

  test("preserves ownership checks on legacy reads", async () => {
    mocks.owned.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      listGmailUsefulDetails({ mailboxId, userId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("cannot turn useful-detail processing back on from an old tab", async () => {
    const result = await setGmailUsefulDetails({
      enabled: true,
      mailboxId,
      userId,
    });
    expect(result).toMatchObject({ enabled: false, mailboxId });
    expect(mocks.insertedValues).toHaveLength(2);
    expect(
      mocks.insertedValues.every((value) =>
        Object.values(value).every((field) => field !== true)
      )
    ).toBeTruthy();
    expect(
      mocks.conflictValues.every((value) =>
        Object.values(value).every((field) => field !== true)
      )
    ).toBeTruthy();
  });
});
