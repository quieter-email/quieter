import type { listMessagesForAgent } from "@quieter/gmail";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { configureErrorReporter } from "@quieter/observability";
import type { ErrorReporter } from "@quieter/observability";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { loadMailAutoLabelHistory } from "../src/mail-automation/history";

const fixtures = vi.hoisted(() => ({
  list: vi.fn<typeof listMessagesForAgent>(),
  reported: vi.fn<ErrorReporter>(),
}));

vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  listMessagesForAgent: fixtures.list,
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: async (request) =>
    await Promise.resolve({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 1,
      id: request.mailboxId,
      organizationId: "fixture-team",
      provider: "gmail" as const,
    }),
}));

const input = {
  accessToken: "fixture-token",
  labels: [{ id: "work", name: "Work" }],
  mailboxId: "fixture-mailbox",
  message: { from: "sender@example.test", id: "target-message" },
  provider: "gmail" as const,
  userId: "fixture-user",
};

describe("automatic label history failures", () => {
  beforeEach(() => {
    fixtures.list.mockReset();
    fixtures.reported.mockReset();
    configureErrorReporter(fixtures.reported);
  });

  test("keeps unexpected optional failures visible without leaking request context", async () => {
    fixtures.list.mockRejectedValue(
      new Error("Transport failed for fixture-token.")
    );
    await expect(loadMailAutoLabelHistory(input)).resolves.toBeNull();
    expect(fixtures.reported).toHaveBeenCalledOnce();
    const [report] = fixtures.reported.mock.calls;
    expect(String(report?.[0])).not.toContain("fixture-token");
    expect(JSON.stringify(report?.[1])).not.toContain(input.mailboxId);
  });
});
