import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  analyzeMailMessage,
  boundMailCaptureContent,
  MAIL_CAPTURE_BODY_LIMIT,
  parseMailUnsubscribeTarget,
} from "../src/capture";

describe("deterministic retained mail analysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("normalizes sender and records separate header and body evidence without fetching targets", () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      throw new Error("Analysis must not make network requests.");
    });
    vi.stubGlobal("fetch", fetch);
    const analysis = analyzeMailMessage({
      bodyHtml:
        '<a href="https://example.com/preferences">Manage preferences</a><a href="https://example.com/leave?a=1&amp;b=2"><strong>Unsubscribe</strong> now</a>',
      bodyText: "Unsubscribe at https://example.com/text-leave",
      headers: [
        { name: "From", value: "Newsletter <NEWS@Example.COM>" },
        { name: "List-ID", value: "Weekly bulletin <weekly.example.com>" },
        {
          name: "List-Unsubscribe",
          value:
            "<https://example.com/header-leave>, <mailto:leave@example.com?subject=unsubscribe>",
        },
        { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
      ],
    });
    expect(analysis.sender).toMatchObject({
      address: "news@example.com",
      domain: "example.com",
    });
    expect(analysis.listId).toBe("weekly.example.com");
    expect(analysis.unsubscribe.oneClickAdvertised).toBeTruthy();
    expect(analysis.unsubscribe.headerTargets).toContainEqual({
      kind: "https",
      target: "https://example.com/header-leave",
    });
    expect(analysis.unsubscribe.bodyCandidates).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "html",
          target: "https://example.com/leave?a=1&b=2",
        }),
        expect.objectContaining({
          source: "text",
          target: "https://example.com/text-leave",
        }),
      ])
    );
    expect(
      analysis.unsubscribe.bodyCandidates.some((candidate) =>
        candidate.target.includes("preferences")
      )
    ).toBeFalsy();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects executable, relative, credential-bearing and injected targets", () => {
    for (const target of [
      // oxlint-disable-next-line eslint/no-script-url -- verifies executable URLs are rejected.
      "javascript:alert(1)",
      "data:text/html,unsubscribe",
      "/leave",
      "https://user:secret@example.com/leave",
      "mailto:leave@example.com?subject=bye%0d%0aBcc=private@example.com",
    ]) {
      expect(parseMailUnsubscribeTarget(target)).toBeNull();
    }
    const analysis = analyzeMailMessage({
      headers: [
        { name: "List-Unsubscribe", value: "<mailto:leave@example.com>" },
        { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
      ],
    });
    expect(analysis.unsubscribe.oneClickAdvertised).toBeFalsy();
  });

  test("bounds retained content and makes truncation visible", () => {
    const bodyText = "unsubscribe https://example.com/leave\n".repeat(30_000);
    const headers = Array.from({ length: 300 }, () => ({
      name: "X-Long",
      value: "private".repeat(3000),
    }));
    const bounded = boundMailCaptureContent({ bodyText, headers });
    const analysis = analyzeMailMessage({ bodyText, headers });
    expect(bounded.bodyText?.length).toBeLessThan(bodyText.length);
    expect(bounded.headers.length).toBeLessThan(headers.length);
    expect(bounded.truncation).toMatchObject({ bodyText: true, headers: true });
    expect(analysis.truncated).toBeTruthy();
  });

  test("retains complete Unicode characters at body and header boundaries", () => {
    const content = `a${"😀".repeat(MAIL_CAPTURE_BODY_LIMIT)}`;
    const bounded = boundMailCaptureContent({
      bodyHtml: content,
      bodyText: content,
      headers: [
        { name: `X${"😀".repeat(256)}`, value: `v${"😀".repeat(8192)}` },
      ],
    });

    for (const text of [
      bounded.bodyHtml,
      bounded.bodyText,
      bounded.headers[0]?.name,
      bounded.headers[0]?.value,
    ]) {
      expect(text).toContain("😀");
      expect(text?.isWellFormed()).toBeTruthy();
    }
    expect(bounded.truncation).toMatchObject({
      bodyHtml: true,
      bodyText: true,
      headers: true,
    });
  });
});
