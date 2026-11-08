import { describe, expect, test } from "vite-plus/test";

import type { AutoLabelSettings } from "../src/auto-label";
import { partitionAutoLabelCandidates } from "../src/auto-label-matching";

const settings: AutoLabelSettings = {
  domains: [],
  enabled: true,
  keywordScope: "anywhere",
  keywords: [],
  matchMode: "all",
  prompt: "",
  senders: [],
};

describe("auto-label matching", () => {
  test("matches the sender address without trusting display names or partial addresses", () => {
    const labels = [
      {
        autoLabel: { ...settings, senders: ["trusted@example.com"] },
        id: "trusted",
      },
    ];
    expect(
      partitionAutoLabelCandidates(labels, {
        from: '"Other name" <TRUSTED@example.com>',
      }).deterministicLabelIds
    ).toContain("trusted");
    for (const from of [
      '"trusted@example.com" <attacker@elsewhere.com>',
      "untrusted@example.com",
      "trusted@example.com.evil.net",
      "trusted@example.com, attacker@elsewhere.com",
      "trusted@example.com <attacker@elsewhere.com>",
    ]) {
      expect(
        partitionAutoLabelCandidates(labels, { from }).deterministicLabelIds
      ).toHaveLength(0);
    }
  });

  test("keeps exact domains and subdomain wildcards on their domain boundaries", () => {
    const labels = [
      { autoLabel: { ...settings, domains: ["example.com"] }, id: "exact" },
      {
        autoLabel: { ...settings, domains: ["*.example.com"] },
        id: "subdomain",
      },
    ];
    expect(
      partitionAutoLabelCandidates(labels, { from: "mail@example.com" })
        .deterministicLabelIds
    ).toStrictEqual(["exact"]);
    for (const from of ["mail@news.example.com", "mail@a.b.example.com"]) {
      expect(
        partitionAutoLabelCandidates(labels, { from }).deterministicLabelIds
      ).toStrictEqual(["subdomain"]);
    }
    for (const from of ["mail@notexample.com", "mail@example.com.evil.net"]) {
      expect(
        partitionAutoLabelCandidates(labels, { from }).deterministicLabelIds
      ).toHaveLength(0);
    }
  });

  test("requires deterministic criteria before AI confirmation and preserves legacy labels", () => {
    const labels = [
      {
        autoLabel: {
          ...settings,
          prompt: "Only invoices",
          senders: ["mail@example.com"],
        },
        id: "mixed",
      },
      { autoLabel: { ...settings, prompt: "Only receipts" }, id: "prompt" },
      {
        autoLabel: { ...settings, senders: ["mail@example.com"] },
        id: "deterministic",
      },
      { autoLabel: { ...settings, enabled: false }, id: "disabled" },
      { autoLabel: null, id: "legacy" },
      { autoLabel: settings, id: "fallback" },
    ];
    const matched = partitionAutoLabelCandidates(labels, {
      from: "mail@example.com",
    });
    expect(matched.deterministicLabelIds).toStrictEqual(["deterministic"]);
    expect(matched.aiLabels.map(({ id }) => id)).toStrictEqual([
      "mixed",
      "prompt",
      "legacy",
      "fallback",
    ]);
    expect(
      partitionAutoLabelCandidates(labels, {
        from: "other@example.com",
      }).aiLabels.map(({ id }) => id)
    ).toStrictEqual(["prompt", "legacy", "fallback"]);
  });

  test("does not match HTML attributes, links, comments, CSS or hidden content", () => {
    const labels = [
      {
        autoLabel: { ...settings, keywords: ["invoice"] },
        id: "finance",
      },
    ];
    const bodyHtml = `
      <html><head><style>.invoice { color: red; }</style></head><body>
        <p class="invoice" title="invoice" data-type="invoice">Hello</p>
        <a href="https://example.com/invoice">Open message</a>
        <img src="invoice.png" alt="invoice">
        <!-- invoice -->
        <script>const invoice = true;</script>
        <span hidden>invoice</span>
        <span aria-hidden="true">invoice</span>
        <span style="display:none">invoice</span>
        <span style="display: none">invoice</span>
      </body></html>`;
    expect(
      partitionAutoLabelCandidates(labels, { bodyHtml }).deterministicLabelIds
    ).toHaveLength(0);
  });
});
