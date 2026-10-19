import { describe, expect, test } from "vite-plus/test";

import {
  autoLabelSettingsSchema,
  partitionAutoLabelCandidates,
} from "../src/auto-label";
import type { AutoLabelSettings } from "../src/auto-label";

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

  test("combines populated categories with all or any and alternatives within a category", () => {
    const common = {
      ...settings,
      domains: ["example.com", "other.com"],
      keywords: ["paid invoice", "receipt"],
    };
    const labels = [
      { autoLabel: common, id: "all" },
      { autoLabel: { ...common, matchMode: "any" as const }, id: "any" },
    ];
    expect(
      partitionAutoLabelCandidates(labels, {
        from: "mail@other.com",
        subject: "Your RECEIPT",
      }).deterministicLabelIds
    ).toStrictEqual(["all", "any"]);
    expect(
      partitionAutoLabelCandidates(labels, {
        from: "mail@other.com",
        subject: "Hello",
      }).deterministicLabelIds
    ).toStrictEqual(["any"]);
    expect(
      partitionAutoLabelCandidates(labels, {
        bodyText: "The paid invoice is attached",
        from: "mail@unrelated.com",
      }).deterministicLabelIds
    ).toStrictEqual(["any"]);
  });

  test("treats keywords as literal phrases and respects subject and body scope", () => {
    const common = { ...settings, keywords: ["sale.*today"] };
    const labels = [
      {
        autoLabel: { ...common, keywordScope: "subject" as const },
        id: "subject",
      },
      { autoLabel: { ...common, keywordScope: "body" as const }, id: "body" },
    ];
    expect(
      partitionAutoLabelCandidates(labels, {
        bodyText: "Sale happens today",
        subject: "SALE.*TODAY",
      }).deterministicLabelIds
    ).toStrictEqual(["subject"]);
    expect(
      partitionAutoLabelCandidates(labels, { bodyText: "sale.*today" })
        .deterministicLabelIds
    ).toStrictEqual(["body"]);
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

  test("rejects ambiguous patterns and normalizes valid addresses", () => {
    for (const domain of [
      "*example.com",
      "example.*",
      "*.*.example.com",
      "https://example.com",
      "example.com/path",
      "example.com.",
      "*.com",
      "a..example.com",
      "-a.example.com",
    ]) {
      expect(
        autoLabelSettingsSchema.safeParse({ ...settings, domains: [domain] })
          .success
      ).toBeFalsy();
    }
    expect(
      autoLabelSettingsSchema.safeParse({
        ...settings,
        senders: ["Name <mail@example.com>"],
      }).success
    ).toBeFalsy();
    expect(
      autoLabelSettingsSchema.safeParse({
        ...settings,
        domains: [`${"a".repeat(64)}.example.com`],
      }).success
    ).toBeFalsy();
    const parsed = autoLabelSettingsSchema.parse({
      ...settings,
      domains: [" *.Example.com "],
      senders: [" MAIL@EXAMPLE.COM "],
    });
    expect(
      partitionAutoLabelCandidates([{ autoLabel: parsed, id: "normalized" }], {
        from: "mail@example.com",
      }).deterministicLabelIds
    ).toHaveLength(0);
    expect(
      partitionAutoLabelCandidates(
        [{ autoLabel: { ...parsed, matchMode: "any" }, id: "normalized" }],
        { from: "mail@example.com" }
      ).deterministicLabelIds
    ).toContain("normalized");
  });
});
