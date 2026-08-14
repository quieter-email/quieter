import { describe, expect, test } from "vite-plus/test";

import {
  isMailSearchFilterSupported,
  parseStructuredSearchQuery,
  serializeStructuredSearchState,
} from "../src/search";

describe("structured mail search", () => {
  test("round-trips repeated and negated filters", () => {
    const search = parseStructuredSearchQuery(
      'from:billing@example.com from:receipts@example.com -subject:"test message" is:unread'
    );

    expect(search).toStrictEqual({
      filters: [
        { type: "from", value: "billing@example.com" },
        { type: "from", value: "receipts@example.com" },
        { negated: true, type: "subject", value: "test message" },
        { type: "is", value: "unread" },
      ],
      text: "",
    });
    expect(serializeStructuredSearchState(search)).toBe(
      'from:billing@example.com from:receipts@example.com -subject:"test message" is:unread'
    );
  });

  test("keeps managed-only filters out of Gmail capabilities", () => {
    expect(
      isMailSearchFilterSupported("managed", {
        type: "subject",
        value: "invoice",
      })
    ).toBeTruthy();
    expect(
      isMailSearchFilterSupported("gmail", {
        type: "subject",
        value: "invoice",
      })
    ).toBeFalsy();
    expect(
      isMailSearchFilterSupported("gmail", { type: "is", value: "outbound" })
    ).toBeFalsy();
  });
});
