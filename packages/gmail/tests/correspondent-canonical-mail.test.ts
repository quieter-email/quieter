import type { MessagePart } from "@quieter/mail/messages";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { listMessagesWithDetails } from "../src/service";

type ProviderMessage = {
  historyId?: string;
  id: string;
  internalDate: string;
  labelIds: string[];
  payload: MessagePart;
  threadId: string;
};

const message = (
  id: string,
  options: {
    addressHeader?: string;
    addressValue?: string;
    historyId?: string;
    labels?: string[];
    time?: number;
  } = {}
): ProviderMessage => ({
  historyId: options.historyId,
  id,
  internalDate: String(options.time ?? 1),
  labelIds: options.labels ?? [],
  payload: {
    headers: [
      { name: "Subject", value: "A conversation" },
      { name: "From", value: "Other <other@example.test>" },
      { name: "List-Id", value: "Updates <updates.example.test>" },
      {
        name: "List-Unsubscribe",
        value: "<https://example.test/unsubscribe>",
      },
      { name: "To", value: "owner@example.test" },
      ...(options.addressHeader
        ? [
            {
              name: options.addressHeader,
              value: options.addressValue ?? "Alex <ALEX@example.test>",
            },
          ]
        : []),
    ].filter(
      (header, index, headers) =>
        !headers
          .slice(index + 1)
          .some((candidate) => candidate.name === header.name)
    ),
    mimeType: "multipart/mixed",
    parts: [
      {
        body: { attachmentId: `${id}-file`, size: 6 },
        filename: `${id}.pdf`,
        mimeType: "application/pdf",
      },
    ],
  },
  threadId: "conversation",
});

const provideThreads = (messages: ProviderMessage[]) => {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      await Promise.resolve();
      if (url.pathname.endsWith("/threads")) {
        return Response.json({
          nextPageToken: "provider-continuation",
          threads: [{ id: "conversation" }],
        });
      }
      if (url.pathname === "/batch/gmail/v1") {
        return new Response(
          [
            "--threads",
            "Content-Type: application/http",
            "Content-ID: <response-thread-0>",
            "",
            "HTTP/1.1 200 OK",
            "Content-Type: application/json",
            "",
            JSON.stringify({
              historyId: "thread-revision",
              id: "conversation",
              messages,
            }),
            "--threads--",
            "",
          ].join("\r\n"),
          { headers: { "Content-Type": "multipart/mixed; boundary=threads" } }
        );
      }
      throw new Error("Unexpected provider request.");
    })
  );
  return requests;
};

describe("canonical correspondent anchors", () => {
  afterEach(() => vi.unstubAllGlobals());

  test.each(["From", "To", "Cc", "Bcc"])(
    "selects the latest eligible exact %s match and retains canonical enrichment",
    async (addressHeader) => {
      const messages = [
        message("old", { addressHeader, time: 1 }),
        message("anchor", {
          addressHeader,
          historyId: "anchor-revision",
          labels: ["SENT", "Label_custom"],
          time: 2,
        }),
        message("substring", {
          addressHeader,
          addressValue: '"alex@example.test" <alex@example.test.invalid>',
          time: 3,
        }),
        ...["DRAFT", "SPAM", "TRASH"].map((label, index) =>
          message(label, { addressHeader, labels: [label], time: index + 4 })
        ),
      ];
      const requests = provideThreads(messages);
      const page = await listMessagesWithDetails("fixture-token", {
        correspondentEmail: "alex@example.test",
        excludeProtected: true,
        pageToken: "provider-start",
      });

      expect(page.messages).toHaveLength(1);
      expect(page.messages[0]).toMatchObject({
        id: "anchor",
        sourceRevision: "anchor-revision",
        threadMessageCount: 5,
        unsubscribeKey: "list:updates.example.test",
        unsubscribeUrl: "https://example.test/unsubscribe",
      });
      expect(page.messages[0]?.threadAttachmentNames).toContain("old.pdf");
      expect(page.messages[0]?.threadLabelIds).toContain("Label_custom");
      expect(page.nextPageToken).toBe("provider-continuation");
      expect(page.historyId).toBe("thread-revision");
      expect(requests[0]?.searchParams.get("pageToken")).toBe("provider-start");
      expect(requests[0]?.searchParams.getAll("labelIds")).toHaveLength(0);
    }
  );

  test("retains the provider continuation after a false-positive-only page", async () => {
    provideThreads([
      message("substring", {
        addressHeader: "From",
        addressValue: '"alex@example.test" <unrelated@example.test>',
      }),
      message("protected", { addressHeader: "To", labels: ["TRASH"] }),
    ]);
    const page = await listMessagesWithDetails("fixture-token", {
      correspondentEmail: "alex@example.test",
      excludeProtected: true,
    });
    expect(page.messages).toHaveLength(0);
    expect(page.nextPageToken).toBe("provider-continuation");
  });

  test("all mail excludes protected anchors without a correspondent filter", async () => {
    provideThreads([
      message("eligible", { labels: ["SENT"], time: 1 }),
      message("spam", { labels: ["SPAM"], time: 2 }),
      message("trash", { labels: ["TRASH"], time: 3 }),
      message("draft", { labels: ["DRAFT"], time: 4 }),
    ]);
    const page = await listMessagesWithDetails("fixture-token", {
      excludeProtected: true,
    });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.id).toBe("eligible");
    expect(page.messages[0]?.sourceRevision).toBeUndefined();
  });

  test("quotes correspondent values at the provider query boundary", async () => {
    const requests = provideThreads([]);
    await listMessagesWithDetails("fixture-token", {
      correspondentEmail: "alex@example.test} in:trash",
      excludeProtected: true,
      query: "subject:proposal OR subject:estimate",
    });
    const query = requests[0]?.searchParams.get("q");
    expect(query).toContain('from:"alex@example.test} in:trash"');
    expect(query).toContain("(subject:proposal OR subject:estimate)");
  });
});
