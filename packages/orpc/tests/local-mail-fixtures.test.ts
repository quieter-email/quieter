import {
  parseRawMailAttachments,
  parseRawMailMessage,
} from "@quieter/mail/raw-message";
import { describe, expect, test } from "vite-plus/test";

import { createLocalFixtureCorpus } from "../src/managed-mail/local-fixture-corpus";

describe("local mail comparison fixtures", () => {
  test("keeps stable identities across repeated seeds", () => {
    const corpus = createLocalFixtureCorpus(
      "fixtures@preview.quieter.test",
      "preview"
    );
    const repeated = createLocalFixtureCorpus(
      "fixtures@preview.quieter.test",
      "preview"
    );
    expect(repeated).toStrictEqual(corpus);
    expect(
      new Set(corpus.map((message) => message.providerMessageId)).size
    ).toBe(corpus.length);
    expect(corpus.some((message) => message.isRead)).toBeTruthy();
    expect(corpus.some((message) => !message.isRead)).toBeTruthy();
  });

  test("creates only safe MIME messages with bodies and timestamps", async () => {
    const corpus = createLocalFixtureCorpus(
      "fixtures@preview.quieter.test",
      "preview"
    );
    const parsed = await Promise.all(
      corpus.map(async (message) => await parseRawMailMessage(message.raw))
    );
    for (const message of parsed) {
      expect(message.from).toMatch(/@[^>]+\.test>/u);
      expect(message.to).toBe("fixtures@preview.quieter.test");
      expect(message.bodyText).toBeTruthy();
      expect(message.date).toBeInstanceOf(Date);
    }
  });

  test("keeps storage keys and provider identities separate between mailboxes", () => {
    const corpus = createLocalFixtureCorpus(
      "fixtures@preview.quieter.test",
      "preview"
    );
    expect(
      corpus.every((message) => message.key.startsWith("fixtures/preview/"))
    ).toBeTruthy();
    const secondMailbox = createLocalFixtureCorpus(
      "fixtures@second.quieter.test",
      "second"
    );
    expect(
      secondMailbox.every(
        (message) =>
          !corpus.some(
            (first) =>
              first.key === message.key ||
              first.providerMessageId === message.providerMessageId
          )
      )
    ).toBeTruthy();
  });

  test("parses one ordered three-message conversation", async () => {
    const corpus = createLocalFixtureCorpus(
      "fixtures@preview.quieter.test",
      "preview"
    );
    const parsed = await Promise.all(
      corpus.map(async (message) => await parseRawMailMessage(message.raw))
    );
    const conversation = parsed.filter(
      (message) =>
        message.subject?.includes("Onboarding checklist draft") === true
    );
    expect(conversation).toHaveLength(3);
    expect(conversation[0]?.inReplyTo).toBeUndefined();
    expect(conversation[1]?.inReplyTo).toBe(conversation[0]?.messageHeaderId);
    expect(conversation[2]?.inReplyTo).toBe(conversation[1]?.messageHeaderId);
    expect(conversation[2]?.references).toBe(
      `${conversation[0]?.messageHeaderId} ${conversation[1]?.messageHeaderId}`
    );
  });

  test("preserves real CSV attachment bytes", async () => {
    const corpus = createLocalFixtureCorpus(
      "fixtures@preview.quieter.test",
      "preview"
    );
    const parsedAttachments = await Promise.all(
      corpus.map(async (message) => await parseRawMailAttachments(message.raw))
    );
    const attachments = parsedAttachments.flat();
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      fileName: "april-payouts.csv",
      mimeType: "text/csv",
    });
    expect(new TextDecoder().decode(attachments[0]?.content)).toContain(
      "payout_fixture_2,64.00,review"
    );
  });

  test.each([
    ["fixtures@example.com", "preview"],
    ["fixtures@preview.quieter.test\r\nBcc: other@example.com", "preview"],
    ["fixtures@preview.quieter.test", "../outside"],
  ])("rejects unsafe destination or storage namespace", (address, suffix) => {
    expect(() => createLocalFixtureCorpus(address, suffix)).toThrow(
      "reserved .test address"
    );
  });
});
