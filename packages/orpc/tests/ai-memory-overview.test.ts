import { ORPCError } from "@orpc/server";
import type * as DatabaseClientModule from "@quieter/database/client";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { loadAiAgentContext } from "../src/ai-memory";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  return { ...actual, db: { select: database.select.bind(database) } };
});

vi.mock(import("../src/mailbox/service"), async (original) => ({
  ...(await original()),
  assertAccessibleMailbox: mocks.access,
}));

const request = { mailboxId: "mailbox-1", userId: "user-1" };

describe("personal context overview failures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: request.mailboxId,
      organizationId: "team",
      provider: "gmail",
    });
  });

  test("requires mailbox access before reading even when cached candidates are supplied", async () => {
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    const input = {
      ...request,
      candidates: [{ content: "Private context" }],
      overview: {},
    };
    await expect(loadAiAgentContext(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  test("propagates read failures instead of returning an empty complete profile", async () => {
    mocks.query.mockRejectedValue(new Error("Read failed"));
    await expect(
      loadAiAgentContext({ ...request, overview: {} })
    ).rejects.toThrow("Failed query");
  });
});
