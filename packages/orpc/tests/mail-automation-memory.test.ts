import { describe, expect, test } from "vite-plus/test";

import {
  buildAutoLabelMemoryProfile,
  groupAutoLabelMemoryRules,
} from "../src/mail-automation/memory";

describe("mail automation memory profiles", () => {
  test("compresses auto-label corrections into durable policies", () => {
    const profile = buildAutoLabelMemoryProfile([
      {
        added: 4,
        labelId: "label-work",
        labelName: "Work",
        removed: 1,
        source: null,
      },
      {
        added: 1,
        labelId: "label-receipts",
        labelName: "Receipts",
        removed: 3,
        source: "store.example",
      },
      {
        added: 1,
        labelId: "label-noise",
        labelName: "Noise",
        removed: 0,
        source: null,
      },
    ]);

    expect(profile).toStrictEqual({
      kind: "auto_label",
      rules: [
        {
          count: 3,
          labelId: "label-receipts",
          labelName: "Receipts",
          policy: "suppress",
          source: "store.example",
        },
        {
          count: 4,
          labelId: "label-work",
          labelName: "Work",
          policy: "prefer",
          source: null,
        },
      ],
    });
  });

  test("drops conflicting auto-label evidence without inventing a policy", () => {
    const profile = buildAutoLabelMemoryProfile([
      {
        added: 3,
        labelId: "label-travel",
        labelName: "Travel",
        removed: 3,
        source: null,
      },
      {
        added: 1,
        labelId: "label-vendor",
        labelName: "Vendor",
        removed: 0,
        source: "vendor.example",
      },
    ]);

    expect(profile).toStrictEqual({
      kind: "auto_label",
      rules: [
        {
          count: 1,
          labelId: "label-vendor",
          labelName: "Vendor",
          policy: "prefer",
          source: "vendor.example",
        },
      ],
    });
  });

  test("preserves every durable auto-label policy as a separate memory candidate", () => {
    const profile = buildAutoLabelMemoryProfile(
      Array.from({ length: 80 }, (_, index) => ({
        added: 5,
        labelId: `label-${index}`,
        labelName: `Very specific label name ${index}`,
        removed: 0,
        source: `sender-${index}.example.com`,
      }))
    );

    expect(profile.rules).toHaveLength(80);
    expect(profile.rules.every((rule) => rule.count === 5)).toBeTruthy();
  });

  test("groups exact sources by policy without dropping rules across content and contact boundaries", () => {
    const sources = Array.from(
      { length: 61 },
      (_, index) =>
        `${String(index).padStart(3, "0")}-${"sender".repeat(12)}@example.test`
    );
    const rules = sources.map((source) => ({
      count: 2,
      labelId: "work",
      labelName: "Work",
      policy: "prefer" as const,
      source,
    }));
    const grouped = groupAutoLabelMemoryRules([
      ...rules,
      {
        count: 3,
        labelId: "work",
        labelName: "Work",
        policy: "suppress",
        source: "unwanted@example.test",
      },
      {
        count: 2,
        labelId: "work",
        labelName: "Work",
        policy: "prefer",
        source: null,
      },
      {
        count: 1,
        labelId: "work",
        labelName: "Work",
        policy: "prefer",
        source: "special.example",
      },
    ]);
    expect(grouped.length).toBeLessThan(rules.length);
    expect(
      grouped.every(
        ({ content, metadata }) =>
          content.length <= 2000 &&
          (metadata?.correspondents?.length ?? 0) <= 20
      )
    ).toBeTruthy();
    const members = grouped.flatMap(
      ({ metadata }) => metadata?.feedbackMembers ?? []
    );
    expect(
      members
        .map(({ source }) => source)
        .toSorted((left, right) => (left ?? "").localeCompare(right ?? ""))
    ).toStrictEqual(
      [...sources, "unwanted@example.test", null, "special.example"].toSorted(
        (left, right) => (left ?? "").localeCompare(right ?? "")
      )
    );
    for (const memory of grouped) {
      const membersWithSource = (
        memory.metadata?.feedbackMembers ?? []
      ).flatMap(({ source }) => (source === null ? [] : [source]));
      expect(
        membersWithSource.every((source) => memory.content.includes(source))
      ).toBeTruthy();
      expect(
        new Set(memory.metadata?.feedbackMembers?.map(({ policy }) => policy))
          .size
      ).toBe(1);
    }
  });
});
