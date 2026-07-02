import { describe, expect, test } from "bun:test";
import {
  buildAutoLabelMemoryProfile,
  buildAutoLabelUserCorrectionContext,
  buildUsefulDetailMemoryProfile,
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

    expect(profile).toEqual({
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

    expect(profile).toEqual({
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

  test("keeps auto-label profile under the prompt budget without a recent window", () => {
    const profile = buildAutoLabelMemoryProfile(
      Array.from({ length: 80 }, (_, index) => ({
        added: 5,
        labelId: `label-${index}`,
        labelName: `Very specific label name ${index}`,
        removed: 0,
        source: `sender-${index}.example.com`,
      })),
    );

    expect(JSON.stringify(profile).length).toBeLessThanOrEqual(900);
    expect(profile.rules.every((rule) => rule.count === 5)).toBe(true);
  });

  test("compresses recent user auto-label corrections without message history", () => {
    const context = buildAutoLabelUserCorrectionContext([
      {
        labelId: "label-dev",
        labelName: "Dev",
        signal: "removed",
        source: "github.com",
      },
      {
        labelId: "label-dev",
        labelName: "Dev",
        signal: "removed",
        source: "github.com",
      },
      {
        labelId: "label-travel",
        labelName: "Travel",
        signal: "added",
        source: "airline.example",
      },
    ]);

    expect(context).toEqual({
      corrections: [
        {
          count: 2,
          labelId: "label-dev",
          labelName: "Dev",
          signal: "removed",
          source: "github.com",
        },
        {
          count: 1,
          labelId: "label-travel",
          labelName: "Travel",
          signal: "added",
          source: "airline.example",
        },
      ],
      kind: "auto_label_user_corrections",
    });
  });

  test("compresses useful-detail feedback into category policies", () => {
    const profile = buildUsefulDetailMemoryProfile([
      { kind: "delivery", notUseful: 1, source: null, useful: 4 },
      { kind: "task", notUseful: 2, source: "github.com", useful: 0 },
      { kind: "bill", notUseful: 1, source: null, useful: 0 },
    ]);

    expect(profile).toEqual({
      kind: "useful_detail",
      rules: [
        { count: 2, kind: "task", policy: "suppress", source: "github.com" },
        { count: 4, kind: "delivery", policy: "prefer", source: null },
      ],
    });
  });

  test("drops conflicting useful-detail feedback without weakening avoid rules", () => {
    const profile = buildUsefulDetailMemoryProfile([
      { kind: "bill", notUseful: 2, source: null, useful: 2 },
      { kind: "delivery", notUseful: 1, source: "shop.example", useful: 0 },
    ]);

    expect(profile).toEqual({
      kind: "useful_detail",
      rules: [{ count: 1, kind: "delivery", policy: "suppress", source: "shop.example" }],
    });
  });
});
