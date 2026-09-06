import { SesSubmissionTransport } from "@quieter/mail/ses-submission-transport";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

describe("native SES submission HTTP transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs a quota read using fetch in the Worker runtime", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        SendQuota: { Max24HourSend: 100, MaxSendRate: 2, SentLast24Hours: 3 },
        SendingEnabled: true,
      })
    );
    vi.stubGlobal("fetch", fetch);
    const transport = new SesSubmissionTransport({
      configurationSetName: "native-fixture",
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
      region: "eu-central-1",
    });
    try {
      await expect(transport.inspectCapacity()).resolves.toMatchObject({
        max24HourSend: 100,
        maxSendRate: 2,
        sendingEnabled: true,
        sentLast24Hours: 3,
      });
      const request = fetch.mock.calls[0]?.[0];
      if (!(request instanceof Request)) {
        throw new Error("Expected a native signed request.");
      }
      expect({ method: request.method, url: request.url }).toStrictEqual({
        method: "GET",
        url: "https://email.eu-central-1.amazonaws.com/v2/email/account",
      });
      expect(request.headers.get("authorization")).toMatch(
        /^AWS4-HMAC-SHA256 /u
      );
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      transport.close();
    }
  });

  it("keeps a lost send response unknown without another HTTP attempt", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("response lost"));
    vi.stubGlobal("fetch", fetch);
    const transport = new SesSubmissionTransport({
      configurationSetName: "native-fixture",
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
      region: "eu-central-1",
    });
    try {
      await expect(
        transport.send({
          attemptId: crypto.randomUUID(),
          bcc: [],
          cc: [],
          deadline: new Date(Date.now() + 60_000),
          from: "sender@example.com",
          raw: "From: sender@example.com\r\nTo: reader@example.com\r\n\r\nFixture",
          replyTo: [],
          submissionId: crypto.randomUUID(),
          tags: [],
          to: ["reader@example.com"],
        })
      ).resolves.toStrictEqual({
        code: "provider_outcome_unknown",
        outcome: "unknown",
      });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      transport.close();
    }
  });
});
