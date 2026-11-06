import { ORPCError } from "@orpc/server";
import { expandMemoryRecallQuery } from "@quieter/ai/ai-memory-recall";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  loadAiAgentContext,
  selectAiMemoryContext,
} from "../src/ai-memory-context";
import { assertAccessibleMailbox } from "../src/mailbox/service";

vi.mock(import("@quieter/ai/ai-memory-recall"), () => ({
  expandMemoryRecallQuery: vi.fn<typeof expandMemoryRecallQuery>(),
}));
vi.mock(import("@quieter/billing/ai-reservation"), async (original) => ({
  ...(await original()),
  createMailboxAiBillingContext: vi.fn<typeof createMailboxAiBillingContext>(),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: vi.fn<typeof assertAccessibleMailbox>(),
}));

const input = {
  agent: "chat",
  mailboxId: "private",
  query: "An overnight journey by air",
  semantic: { billingMailboxId: "private" },
  userId: "actor",
};

describe("paid semantic recall authority", () => {
  beforeEach(() => {
    vi.mocked(assertAccessibleMailbox).mockReset();
    vi.mocked(createMailboxAiBillingContext).mockReset();
    vi.mocked(expandMemoryRecallQuery).mockReset();
    vi.mocked(assertAccessibleMailbox).mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 1,
      id: "private",
      organizationId: "org",
      provider: "gmail",
    });
    vi.mocked(createMailboxAiBillingContext).mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: "recall",
      kind: "team",
      organizationId: "org",
      usageKind: "aiMemory",
    });
    vi.mocked(expandMemoryRecallQuery).mockResolvedValue(["red-eye flights"]);
  });

  test("denied mailbox access prevents inference and billing", async () => {
    vi.mocked(assertAccessibleMailbox).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    await expect(loadAiAgentContext(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(expandMemoryRecallQuery).not.toHaveBeenCalled();
    expect(createMailboxAiBillingContext).not.toHaveBeenCalled();
  });

  test("billing admission failure prevents inference", async () => {
    vi.mocked(createMailboxAiBillingContext).mockRejectedValue(
      new ORPCError("FORBIDDEN")
    );
    await expect(loadAiAgentContext(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(expandMemoryRecallQuery).not.toHaveBeenCalled();
  });

  test("a revoked grant after inference cannot fall back to old authorization", async () => {
    const pending = Promise.withResolvers<string[]>();
    vi.mocked(expandMemoryRecallQuery).mockReturnValue(pending.promise);
    const request = loadAiAgentContext(input);
    await vi.waitFor(() => {
      expect(expandMemoryRecallQuery).toHaveBeenCalledWith(
        expect.objectContaining({ query: input.query })
      );
    });
    vi.mocked(assertAccessibleMailbox).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    pending.resolve(["red-eye flights"]);
    await expect(request).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("billing mailbox access is independently required for mailbox-free recall", async () => {
    vi.mocked(assertAccessibleMailbox).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    await expect(
      loadAiAgentContext({ ...input, mailboxId: undefined })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(expandMemoryRecallQuery).not.toHaveBeenCalled();
  });

  test("generated search terms cannot select another correspondent's writing style", () => {
    const now = new Date();
    const recipient = {
      archivedAt: null,
      confidence: 1,
      content: "With Alex use a playful tone.",
      createdAt: now,
      expiresAt: null,
      id: "recipient",
      importance: 4,
      key: "recipient",
      kind: "learned",
      lastConfirmedAt: now,
      lastUsedAt: null,
      mailboxId: null,
      metadata: {
        agents: ["all"],
        category: "writing_style",
        correspondents: ["alex@example.test"],
      },
      reinforcementCount: 1,
      scope: "user",
      scopeKey: "user:actor",
      source: "inferred",
      sourceReference: null,
      status: "active",
      summary: "Recipient voice",
      updatedAt: now,
      userId: "actor",
      version: 1,
    } satisfies Parameters<
      typeof selectAiMemoryContext
    >[0]["candidates"][number];
    const context = selectAiMemoryContext({
      agent: "compose",
      candidates: [recipient],
      query: "Reply to blair@example.test",
      recallTerms: ["alex@example.test playful Alex tone"],
    });
    expect(context.memory).toBeNull();
  });

  test("uncertain paid provider failures stop retrieval instead of continuing with empty context", async () => {
    vi.mocked(expandMemoryRecallQuery).mockRejectedValue(
      new Error("Provider connection lost")
    );
    await expect(loadAiAgentContext(input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  test("wrapped credit admission errors preserve their expected failure", async () => {
    vi.mocked(expandMemoryRecallQuery).mockRejectedValue(
      new Error("Provider wrapper", { cause: new ORPCError("FORBIDDEN") })
    );
    await expect(loadAiAgentContext(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
