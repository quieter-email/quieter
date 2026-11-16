import { describe, expect, test } from "vite-plus/test";

import { matchesHistoryCorrespondent } from "../src/correspondent-history";

describe("exact correspondent mail sources", () => {
  test("matches address lists, groups and mixed case without merging aliases", () => {
    expect(
      matchesHistoryCorrespondent(
        {
          bcc: 'Reviewers: "Doe, Alex" <ALEX+Plan@example.test>, Other <other@example.test>;',
          labelIds: ["SENT"],
        },
        "alex+plan@example.test"
      )
    ).toBeTruthy();
    expect(
      matchesHistoryCorrespondent(
        { to: "Alex <alex+plan@example.test>" },
        "alex@example.test"
      )
    ).toBeFalsy();
  });

  test("does not mistake a display name or substring for a participant", () => {
    expect(
      matchesHistoryCorrespondent(
        {
          from: '"alex@example.test" <other@example.test>',
          to: "not-alex@example.test, alex@example.test.invalid",
        },
        "alex@example.test"
      )
    ).toBeFalsy();
  });

  test.each(["DRAFT", "SPAM", "TRASH"])(
    "excludes an ineligible source carrying %s",
    (label) => {
      expect(
        matchesHistoryCorrespondent(
          { from: "alex@example.test", labelIds: [label] },
          "alex@example.test"
        )
      ).toBeFalsy();
    }
  );

  test("keeps sent, archived and Done mail eligible", () => {
    for (const labelIds of [[], ["SENT"], ["DONE"]]) {
      expect(
        matchesHistoryCorrespondent(
          { from: "Alex <alex@example.test>", labelIds },
          "alex@example.test"
        )
      ).toBeTruthy();
    }
  });
});
