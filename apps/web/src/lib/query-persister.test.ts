import { describe, expect, test } from "vite-plus/test";
import { messagesQueryOptions } from "./gmail/inbox-query/sync";
import { labelsQueryOptions } from "./gmail/labels-query";
import { getThreadWithDetailsOptions } from "./gmail/thread-query";
import { mailboxesQueryOptions } from "./mailboxes-query";
import {
  managedLabelCountsQueryOptions,
  managedRulesQueryOptions,
  managedSavedViewsQueryOptions,
} from "./managed-mailbox-organization-query";
import { queryPersister, shouldPersistQueryKey } from "./query-persister";

const getPersister = (options: { persister?: unknown }) => options.persister;

describe("query persistence allowlist", () => {
  test("persists unfiltered mailbox message lists only", () => {
    expect(getPersister(messagesQueryOptions("mailbox-a", "inbox"))).toBe(
      queryPersister.persisterFn,
    );
    expect(getPersister(messagesQueryOptions("mailbox-a", "inbox", ""))).toBe(
      queryPersister.persisterFn,
    );
    expect(getPersister(messagesQueryOptions("mailbox-a", "inbox", "from:alex"))).toBeUndefined();
  });

  test("persists mailbox and label navigation metadata", () => {
    expect(getPersister(mailboxesQueryOptions())).toBe(queryPersister.persisterFn);
    expect(getPersister(labelsQueryOptions("mailbox-a"))).toBe(queryPersister.persisterFn);
    expect(getPersister(managedSavedViewsQueryOptions("mailbox-a"))).toBe(
      queryPersister.persisterFn,
    );
    expect(getPersister(managedLabelCountsQueryOptions("mailbox-a"))).toBe(
      queryPersister.persisterFn,
    );
  });

  test("does not persist opened threads or managed rules", () => {
    expect(getPersister(getThreadWithDetailsOptions("mailbox-a", "thread-a"))).toBeUndefined();
    expect(getPersister(managedRulesQueryOptions("mailbox-a"))).toBeUndefined();
  });

  test("matches manual persistence to the same metadata scope", () => {
    expect(shouldPersistQueryKey(["messages", "mailbox-a", "inbox", ""])).toBe(true);
    expect(shouldPersistQueryKey(["messages", "mailbox-a", "inbox", "from:alex"])).toBe(false);
    expect(shouldPersistQueryKey(["message-thread", 3, "mailbox-a", "thread-a"])).toBe(false);
    expect(shouldPersistQueryKey(["mailboxes"])).toBe(true);
    expect(shouldPersistQueryKey(["gmail-labels", "mailbox-a"])).toBe(true);
    expect(shouldPersistQueryKey(["managed-saved-views", "mailbox-a"])).toBe(true);
    expect(shouldPersistQueryKey(["managed-label-counts", "mailbox-a"])).toBe(true);
  });
});
