import { describe, expect, test } from "vite-plus/test";

import {
  agentNotFoundMarkdown,
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
  const llmsTxt = buildLlmsTxt();

  test("describes the product, when-to-use guidance, and surfaces", () => {
    expect(llmsTxt).toContain("# Quieter");
    expect(llmsTxt).toContain("## When to use Quieter");
    expect(llmsTxt).toContain("https://quieter.email/openapi.json");
    expect(llmsTxt).toContain("coming soon");
    expect(llmsTxt).toContain("support@quieter.email");
  });

  test("documents the deprecation policy without inventing URLs", () => {
    expect(llmsTxt).toContain("/api/v1");
    expect(llmsTxt).toContain("Deprecation headers");
    expect(llmsTxt.match(/MCP server: coming soon/gu)).toHaveLength(1);
    expect(llmsTxt).not.toContain("/mcp");
  });
});

describe("sitemap.xml", () => {
  const sitemap = buildSitemapXml();

  test("lists public pages with lastmod dates only", () => {
    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain("<loc>https://quieter.email/home</loc>");
    expect(sitemap).toContain("<loc>https://quieter.email/about</loc>");
    expect(sitemap).toContain("<loc>https://quieter.email/contact</loc>");
    expect(sitemap).toContain("<lastmod>");
  });

  test("excludes gated application paths", () => {
    for (const path of ["/onboarding", "/settings", "/site-password"]) {
      expect(sitemap).not.toContain(path);
    }
  });
});

describe("agent not found body", () => {
  test("points at machine-readable entry points", () => {
    expect(agentNotFoundMarkdown).toContain("/llms.txt");
    expect(agentNotFoundMarkdown).toContain("/sitemap.xml");
    expect(agentNotFoundMarkdown).toContain("/openapi.json");
  });
});
