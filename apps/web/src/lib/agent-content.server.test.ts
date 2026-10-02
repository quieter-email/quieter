import { describe, expect, test } from "vite-plus/test";

import {
  buildLlmsTxt,
  buildSitemapXml,
  getAgentMarkdown,
} from "./agent-content.server";

describe("agent markdown content", () => {
  test("serves markdown for every public document path", () => {
    for (const path of [
      "/",
      "/home",
      "/about",
      "/contact",
      "/privacy",
      "/terms",
      "/cookies",
      "/imprint",
    ]) {
      const markdown = getAgentMarkdown(path);

      expect(markdown).toBeTruthy();
      expect(markdown).toContain("# ");
    }
  });

  test("returns undefined for gated or unknown paths", () => {
    expect(getAgentMarkdown("/onboarding")).toBeUndefined();
    expect(getAgentMarkdown("/definitely-not-a-page")).toBeUndefined();
  });
});

describe("llms.txt", () => {
  test("documents the deprecation policy and the MCP boundary", () => {
    const llmsTxt = buildLlmsTxt();
    expect(llmsTxt).toContain("/api/v1");
    expect(llmsTxt).not.toContain("MCP server: coming soon");
  });
});

describe("sitemap.xml", () => {
  test("excludes gated application paths", () => {
    const sitemap = buildSitemapXml();
    for (const path of ["/onboarding", "/settings", "/site-password"]) {
      expect(sitemap).not.toContain(path);
    }
  });
});
