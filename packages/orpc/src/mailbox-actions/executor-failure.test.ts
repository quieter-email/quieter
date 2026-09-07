import { describe, expect, test } from "vite-plus/test";

import { mailboxActionFailureUpdate } from "./executor";

describe(mailboxActionFailureUpdate, () => {
  test("returns transient failures to the queue so redeliveries can claim them", () => {
    const update = mailboxActionFailureUpdate(new Error("gmail 500"), {
      finalAttempt: false,
    });

    expect(update.status).toBe("queued");
    expect(update.completedAt).toBeNull();
    expect(update.leasedUntil).toBeNull();
    expect(update.lastError).toBe("gmail 500");
    expect(update.updatedAt).toBeInstanceOf(Date);
  });

  test("settles the run as failed on the final delivery", () => {
    const update = mailboxActionFailureUpdate(new Error("gmail 500"), {
      finalAttempt: true,
    });

    expect(update.status).toBe("failed");
    expect(update.completedAt).toBeInstanceOf(Date);
    expect(update.lastError).toBe("gmail 500");
    expect(update.leasedUntil).toBeNull();
  });

  test("falls back to a generic message for non-error throwables", () => {
    const update = mailboxActionFailureUpdate("boom", { finalAttempt: true });

    expect(update.lastError).toBe("Mailbox action failed.");
  });
});
