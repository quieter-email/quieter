import { describe, expect, test } from "vite-plus/test";

import {
  getHistoryCorrespondents,
  matchesHistoryCorrespondent,
} from "../src/correspondent-history";

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

describe("history correspondents", () => {
  test("collects envelope participants in order and keeps the first useful name", () => {
    const correspondents = getHistoryCorrespondents([
      {
        bcc: "bare@example.test",
        cc: "alex+plan@EXAMPLE.test",
        from: '"Doe, Alex" <ALEX+Plan@example.test>',
        to: "Reviewers: unnamed@example.test, Other <other@example.test>;",
      },
      {
        bcc: "Alex <alex@example.test>",
        cc: "Replacement <other@example.test>",
        from: '"  " <bare@example.test>',
        to: "Named Later <UNNAMED@example.test>",
      },
    ]);

    expect(correspondents).toMatchObject([
      { email: "alex+plan@example.test", name: "Doe, Alex" },
      { email: "unnamed@example.test", name: "Named Later" },
      { email: "other@example.test", name: "Other" },
      { email: "bare@example.test", name: null },
      { email: "alex@example.test", name: "Alex" },
    ]);
    expect(correspondents).toHaveLength(5);
  });

  test("ignores invalid addresses, display-name identities and reply-to", () => {
    const message = {
      bcc: "valid+tag@example.test",
      cc: "No Address, invalid@localhost, Invalid <broken@@example.test>",
      from: '"identity@example.test" <actual@example.test>',
      replyTo: "reply@example.test",
      to: "Another <actual@EXAMPLE.test>",
    };
    const correspondents = getHistoryCorrespondents([message]);

    expect(correspondents).toMatchObject([
      { email: "actual@example.test", name: "identity@example.test" },
      { email: "valid+tag@example.test", name: null },
    ]);
    expect(correspondents).toHaveLength(2);
    for (const email of [
      "identity@example.test",
      "reply@example.test",
      "invalid@localhost",
      "broken@@example.test",
      "valid@example.test",
      " valid+tag@example.test ",
    ]) {
      expect(matchesHistoryCorrespondent(message, email)).toBeFalsy();
    }
    expect(
      matchesHistoryCorrespondent(message, "valid+tag@example.test")
    ).toBeTruthy();
    expect(
      matchesHistoryCorrespondent(message, "VALID+TAG@example.test")
    ).toBeFalsy();
  });

  test("keeps extraction and matching eligibility in parity", () => {
    const messages = [
      { from: "draft@example.test", labelIds: ["INBOX", "DRAFT"] },
      { labelIds: ["SENT", "SPAM"], to: "spam@example.test" },
      { cc: "trash@example.test", labelIds: ["DONE", "TRASH"] },
      { bcc: "archived@example.test", labelIds: [] },
      { from: "sent@example.test", labelIds: ["SENT"] },
      { labelIds: ["DONE"], to: "done@example.test" },
    ];
    const correspondents = getHistoryCorrespondents(messages);

    expect(correspondents).toMatchObject([
      { email: "archived@example.test" },
      { email: "sent@example.test" },
      { email: "done@example.test" },
    ]);
    expect(correspondents).toHaveLength(3);
    for (const email of [
      "draft@example.test",
      "spam@example.test",
      "trash@example.test",
    ]) {
      expect(
        messages.some((message) => matchesHistoryCorrespondent(message, email))
      ).toBeFalsy();
    }
    for (const email of [
      "archived@example.test",
      "sent@example.test",
      "done@example.test",
    ]) {
      expect(
        messages.some((message) => matchesHistoryCorrespondent(message, email))
      ).toBeTruthy();
    }
  });
});
