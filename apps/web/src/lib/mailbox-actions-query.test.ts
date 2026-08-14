import { describe, expect, test } from "vite-plus/test";

import {
  mailboxActionQueryKey,
  mailboxActionsListQueryKey,
} from "./mailbox-actions-query";

describe("mailbox action query keys", () => {
  test("include the mailbox boundary", () => {
    expect(mailboxActionsListQueryKey("mailbox-one")).toStrictEqual([
      "mailbox-actions",
      "mailbox-one",
    ]);
    expect(mailboxActionQueryKey("mailbox-one", "action-one")).toStrictEqual([
      "mailbox-action",
      "mailbox-one",
      "action-one",
    ]);
  });
});
