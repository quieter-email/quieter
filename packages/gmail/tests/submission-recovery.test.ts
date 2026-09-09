import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { findGmailSubmission } from "../src/service";

describe("delivery and recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("looks for the stable sent message identifier across spam and trash without sending again", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push(new URL(url));
      expect(init.method).toBe("GET");
      await Promise.resolve();
      return Response.json({ messages: [{ id: "sent", threadId: "thread" }] });
    });
    await expect(
      findGmailSubmission("test-token", "a".repeat(64), "send")
    ).resolves.toStrictEqual({ id: "sent", threadId: "thread" });
    expect(requests[0].searchParams.get("q")).toBe(
      `rfc822msgid:<quieter-${"a".repeat(64)}@sync.quieter.email>`
    );
    expect(requests[0].searchParams.get("includeSpamTrash")).toBe("true");
  });

  test("does not invent a receipt for missing or ambiguous results", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ messages: [] }))
      .mockResolvedValueOnce(
        Response.json({
          drafts: [
            { id: "draft-a", message: { id: "a", threadId: "thread" } },
            { id: "draft-b", message: { id: "b", threadId: "thread" } },
          ],
        })
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      findGmailSubmission("test-token", "a".repeat(64), "send")
    ).resolves.toBeNull();
    await expect(
      findGmailSubmission("test-token", "a".repeat(64), "draft")
    ).resolves.toBeNull();
    await expect(
      findGmailSubmission("test-token", "invalid", "send")
    ).rejects.toThrow("Invalid");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
