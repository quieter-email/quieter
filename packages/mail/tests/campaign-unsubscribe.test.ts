import PostalMime from "postal-mime";
import { describe, expect, test } from "vite-plus/test";

import {
  customUnsubscribeUrlSchema,
  freezeCampaignUnsubscribe,
  renderCampaignEmail,
  unsubscribeSnapshotSchema,
} from "../src/campaign-unsubscribe";
import { sendMessageInputSchema } from "../src/send";
import { buildSendMimeMessage } from "../src/send-mime";

describe("campaign unsubscribe delivery", () => {
  test.each([
    "https://news.example.com/u/{{unsubscribe_token}}",
    "https://news.example.com/u?list=weekly&token={{unsubscribe_token}}",
  ])(
    "keeps a personal HTTPS destination in raw MIME for %s",
    async (urlTemplate) => {
      const unsubscribe = freezeCampaignUnsubscribe({
        audiencePolicy: { kind: "custom", urlTemplate },
        campaignOverride: null,
        managedOrigin: undefined,
      });
      const first = renderCampaignEmail({
        html: "<html><body><p>News</p></body></html>",
        text: "News",
        token: "a".repeat(43),
        unsubscribe,
      });
      const second = renderCampaignEmail({
        html: null,
        text: "News",
        token: "b".repeat(43),
        unsubscribe,
      });
      const built = await buildSendMimeMessage(
        sendMessageInputSchema.parse({
          ...first,
          from: "updates@example.com",
          subject: "An update",
          to: ["reader@example.net"],
        })
      );
      const parsed = await PostalMime.parse(built.raw);
      const targets = parsed.headers.filter(
        (header) => header.key.toLowerCase() === "list-unsubscribe"
      );
      expect(targets).toHaveLength(1);
      expect(targets[0]?.value).toBe(
        `<${urlTemplate.replace("{{unsubscribe_token}}", "a".repeat(43))}>`
      );
      expect(
        parsed.headers.filter(
          (header) => header.key.toLowerCase() === "list-unsubscribe-post"
        )
      ).toMatchObject([{ value: "List-Unsubscribe=One-Click" }]);
      expect(parsed.text).toContain("a".repeat(43));
      expect(parsed.html).toContain("a".repeat(43));
      expect(parsed.html).not.toContain("{{unsubscribe_token}}");
      expect(second.headers["List-Unsubscribe"]).not.toBe(
        first.headers["List-Unsubscribe"]
      );
      expect(second.text).toContain("b".repeat(43));
    }
  );

  test("freezes inheritance and allows an explicit managed override", () => {
    const audiencePolicy = {
      kind: "custom" as const,
      urlTemplate: "https://old.example.com/u/{{unsubscribe_token}}",
    };
    const inherited = freezeCampaignUnsubscribe({
      audiencePolicy,
      campaignOverride: null,
      managedOrigin: "https://app.example.com",
    });
    audiencePolicy.urlTemplate =
      "https://changed.example.com/u/{{unsubscribe_token}}";
    const queued = renderCampaignEmail({
      html: null,
      text: "News",
      token: "a".repeat(43),
      unsubscribe: inherited,
    });
    expect(queued.headers["List-Unsubscribe"]).toContain("old.example.com");
    const managed = renderCampaignEmail({
      html: null,
      text: "News",
      token: "a".repeat(43),
      unsubscribe: freezeCampaignUnsubscribe({
        audiencePolicy,
        campaignOverride: { kind: "managed" },
        managedOrigin: "https://app.example.com",
      }),
    });
    expect(managed.headers["List-Unsubscribe"]).toContain(
      "https://app.example.com/unsubscribe/"
    );
    expect(managed.text).toContain("https://app.example.com/unsubscribe/");
    expect(managed.text).not.toContain("changed.example.com");
  });

  test("preserves legacy queued header and body routing", () => {
    const message = renderCampaignEmail({
      html: null,
      text: "News",
      token: "a".repeat(43),
      unsubscribe: {
        kind: "managed",
        origin: "https://app.example.com",
        version: 0,
      },
    });
    expect(message.headers["List-Unsubscribe"]).toContain("/api/unsubscribe/");
    expect(message.text).toContain("https://app.example.com/unsubscribe/");
    expect(message.text).not.toContain("/api/unsubscribe/");
  });

  test.each([
    "http://news.example.com/u/{{unsubscribe_token}}",
    "https://news.example.com/u",
    "https://news.example.com/u/{{unsubscribe_token}}/{{unsubscribe_token}}",
    "https://news.example.com/u/prefix-{{unsubscribe_token}}",
    "https://news.example.com/u?{{unsubscribe_token}}=yes",
    "https://{{unsubscribe_token}}.example.com/u",
    "https://name:password@news.example.com/u/{{unsubscribe_token}}",
    "https://news.example.com/u#{{unsubscribe_token}}",
    "https://news.example.com/u/{{unsubscribe_token}}/..",
    "https://news.example.com/u/{{unsubscribe_token}}?other={{email}}",
    "https://news.example.com/u/{{unsubscribe_token}}\r\nBcc:other@example.com",
    "https://news.example.com\\u\\{{unsubscribe_token}}",
    "https://news.example.com/prefix-{{unsubscribe_token}}?decoy=__quieter_unsubscribe_token__",
    "https://news.example.com/prefix-{{unsubscribe_token}}?decoy=%5F%5Fquieter_unsubscribe_token%5F%5F",
  ])("rejects unsafe or nonpersonal custom templates: %s", (url) => {
    expect(customUnsubscribeUrlSchema.safeParse(url).success).toBeFalsy();
  });

  test("rejects unrecognized or unsafe saved snapshots", () => {
    expect(
      unsubscribeSnapshotSchema.safeParse({
        kind: "managed",
        origin: "https://app.example.com",
        version: 2,
      }).success
    ).toBeFalsy();
    expect(
      unsubscribeSnapshotSchema.safeParse({
        kind: "managed",
        origin: "https://private:credential@app.example.com/path",
        version: 1,
      }).success
    ).toBeFalsy();
  });
});
