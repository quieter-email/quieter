import { describe, expect, test } from "vite-plus/test";

import { isAiCrawlerRequest, prefersMarkdown } from "./agent-access.server";

const createRequest = (headers: Record<string, string>, method = "GET") =>
  new Request("https://quieter.email/home", { headers, method });

describe("ai crawler detection", () => {
  test("matches known AI crawler user agents", () => {
    const userAgents = [
      "GPTBot/1.0 (+https://openai.com/gptbot)",
      "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "ChatGPT-User/1.0 (+https://openai.com/bot)",
      "PerplexityBot/1.0",
      "Mozilla/5.0 (compatible; Google-Extended)",
      "Applebot-Extended",
      "DeepSeekBot/1.0",
      "ora-agent (https://is-agentic.com)",
    ];

    for (const userAgent of userAgents) {
      expect(
        isAiCrawlerRequest(createRequest({ "user-agent": userAgent }))
      ).toBeTruthy();
    }
  });

  test("does not match browsers or unknown clients", () => {
    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "curl/8.9.1",
      "",
    ];

    for (const userAgent of userAgents) {
      expect(
        isAiCrawlerRequest(createRequest({ "user-agent": userAgent }))
      ).toBeFalsy();
    }

    expect(isAiCrawlerRequest(createRequest({}))).toBeFalsy();
  });
});

describe("markdown preference detection", () => {
  test("detects text/markdown in accept header", () => {
    expect(
      prefersMarkdown(createRequest({ accept: "text/markdown" }))
    ).toBeTruthy();
  });

  test("ignores html and wildcard accepts", () => {
    expect(prefersMarkdown(createRequest({}))).toBeFalsy();
    expect(
      prefersMarkdown(
        createRequest({
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })
      )
    ).toBeFalsy();
  });
});
