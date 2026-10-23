import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import type { MessagePart } from "@quieter/mail/messages";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  getGmailCapturedSnapshot,
  getThreadWithDetails,
  listGmailCaptureHistoryPage,
} from "../src/service";

describe("Gmail capture adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("retains inline and attachment-backed bodies without downloading binary attachments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (
          url.origin !== "https://gmail.googleapis.com" ||
          request.method !== "GET"
        ) {
          throw new Error("Unexpected external operation during capture.");
        }
        if (url.pathname.endsWith("/attachments/html-body")) {
          return Response.json({
            data: btoa("<p>Complete HTML body</p>"),
          });
        }
        if (!url.pathname.endsWith("/messages/example-message")) {
          throw new Error("Capture downloaded an unrelated resource.");
        }
        const bodyWasRequested =
          !url.searchParams.has("fields") ||
          url.searchParams.get("fields")?.includes("data") === true;
        return await Promise.resolve(
          Response.json({
            historyId: "9007199254740993",
            id: "example-message",
            internalDate: "1700000000000",
            labelIds: ["INBOX"],
            payload: {
              headers: [{ name: "From", value: "Sender <sender@example.com>" }],
              mimeType: "multipart/mixed",
              parts: [
                {
                  mimeType: "multipart/alternative",
                  parts: [
                    {
                      body: {
                        data: bodyWasRequested
                          ? btoa("Complete text body")
                          : undefined,
                      },
                      mimeType: "text/plain",
                    },
                    {
                      body: { attachmentId: "html-body", size: 5000 },
                      mimeType: "text/html",
                    },
                  ],
                },
                {
                  body: { attachmentId: "binary-pdf", size: 10_000 },
                  filename: "report.pdf",
                  mimeType: "application/pdf",
                  partId: "1",
                },
              ],
            },
            threadId: "example-thread",
          })
        );
      })
    );

    const snapshot = await getGmailCapturedSnapshot(
      "synthetic-token",
      "example-message"
    );
    expect(snapshot.bodyText).toContain("Complete text body");
    expect(snapshot.bodyHtml).toContain("Complete HTML body");
    expect(snapshot.attachments).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachmentId: "binary-pdf",
          fileName: "report.pdf",
        }),
      ])
    );
    expect(snapshot.providerRevision).toBe("9007199254740993");
  });

  test("captures deeply nested content when an older thread is opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url);
        if (!url.pathname.endsWith("/threads/older-thread")) {
          throw new Error("Unexpected resource while opening a thread.");
        }
        let payload: MessagePart = {
          body: {
            data: btoa("Deep retained content"),
          },
          mimeType: "text/plain",
        };
        for (let depth = 0; depth < 8; depth += 1) {
          payload = { mimeType: "multipart/mixed", parts: [payload] };
        }
        return await Promise.resolve(
          Response.json({
            id: "older-thread",
            messages: [
              {
                historyId: "55",
                id: "old-message",
                internalDate: "1600000000000",
                labelIds: ["INBOX"],
                payload: url.searchParams.has("fields")
                  ? { mimeType: "multipart/mixed" }
                  : payload,
                threadId: "older-thread",
              },
            ],
          })
        );
      })
    );
    const captured: CapturedMailSnapshot[] = [];
    await getThreadWithDetails(
      "synthetic-token",
      "older-thread",
      undefined,
      async (snapshot) => {
        captured.push(snapshot);
        await Promise.resolve();
      }
    );
    expect(captured[0]?.bodyText).toContain("Deep retained content");
  });

  test("preserves added, label and permanent deletion events across a bounded history page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({
              history: [
                {
                  id: "101",
                  messagesAdded: [
                    { message: { id: "arrived", threadId: "thread-a" } },
                  ],
                },
                {
                  id: "102",
                  labelsAdded: [
                    {
                      labelIds: ["TRASH"],
                      message: { id: "existing", threadId: "thread-b" },
                    },
                  ],
                  labelsRemoved: [
                    {
                      labelIds: ["INBOX"],
                      message: { id: "existing", threadId: "thread-b" },
                    },
                  ],
                },
                {
                  id: "103",
                  messagesDeleted: [
                    { message: { id: "deleted", threadId: "thread-c" } },
                  ],
                },
              ],
              historyId: "110",
              nextPageToken: "continuation",
            })
          )
      )
    );
    const page = await listGmailCaptureHistoryPage("synthetic-token", {
      startHistoryId: "100",
    });
    expect(page.changes).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "added",
          messageId: "arrived",
          providerRevision: "101",
        }),
        expect.objectContaining({
          kind: "labels",
          messageId: "existing",
          providerRevision: "102",
        }),
        expect.objectContaining({
          kind: "deleted",
          messageId: "deleted",
          providerRevision: "103",
        }),
      ])
    );
    expect(page.nextPageToken).toBe("continuation");
    expect(page.historyExpired).toBeFalsy();
  });
});
