/// <reference types="node" />
import { describe, expect, it } from "vite-plus/test";

import { normalizeMailSubmissionRequest } from "../src/mail-submission-request.ts";

describe("submission request identity", () => {
  const message = {
    attachments: [{ content: "aGVsbG8=", filename: "hello.txt" }],
    from: "Sender <sender@example.com>",
    subject: "Hello",
    text: "Hello there",
    to: "reader@example.com",
  };

  it("normalizes parsed defaults, attachment encoding, metadata keys, and header casing", () => {
    const first = normalizeMailSubmissionRequest({
      ...message,
      headers: { "X-A": " one ", "X-B": "two" },
      idempotencyKey: "first-key",
      metadata: { first: 1, second: true },
    });
    const second = normalizeMailSubmissionRequest({
      ...message,
      attachments: [
        {
          content: "aGVs\nbG8=",
          contentType: "application/octet-stream",
          disposition: "attachment",
          filename: "hello.txt",
        },
      ],
      headers: [
        { name: "x-b", value: "two" },
        { name: "x-a", value: "one" },
      ],
      idempotencyKey: "another-key",
      metadata: { first: 1, second: true },
      tags: [],
      to: ["reader@example.com"],
    });
    expect(first.requestHash).toBe(second.requestHash);
  });

  it.each([
    { attachments: [{ content: "d29ybGQ=", filename: "hello.txt" }] },
    { attachments: [{ content: "aGVsbG8=", filename: "different.txt" }] },
    { bcc: ["hidden@example.com"] },
    { text: "Changed body" },
    { openTracking: false },
    { metadata: { campaign: "new" } },
  ])("distinguishes changed client intent: %j", (change) => {
    const original = normalizeMailSubmissionRequest(message);
    const changed = normalizeMailSubmissionRequest({ ...message, ...change });
    expect(changed.requestHash).not.toBe(original.requestHash);
  });

  it("preserves repeated-header order and rejects unsupported or invalid identity fields", () => {
    const headers = [
      { name: "X-Order", value: "one" },
      { name: "X-Order", value: "two" },
    ];
    const original = normalizeMailSubmissionRequest({ ...message, headers });
    const reordered = normalizeMailSubmissionRequest({
      ...message,
      headers: [headers[1], headers[0]],
    });
    expect(original.requestHash).not.toBe(reordered.requestHash);
    expect(() =>
      normalizeMailSubmissionRequest({ ...message, futureBehavior: true })
    ).toThrow("Unrecognized key");
    expect(() =>
      normalizeMailSubmissionRequest({
        ...message,
        idempotencyKey: "has spaces",
      })
    ).toThrow("idempotencyKey");
    expect(() =>
      normalizeMailSubmissionRequest({
        ...message,
        idempotencyKey: "a".repeat(129),
      })
    ).toThrow("idempotencyKey");
  });
});
