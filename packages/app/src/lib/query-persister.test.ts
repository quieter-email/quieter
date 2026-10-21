import { messagesQueryOptions } from "@quieter/app/lib/mail/inbox-query/sync";
import { labelsQueryOptions } from "@quieter/app/lib/mail/labels-query";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import {
  managedLabelCountsQueryOptions,
  managedRulesQueryOptions,
} from "@quieter/app/lib/managed-mailbox-organization-query";
import {
  queryPersister,
  shouldPersistQueryKey,
} from "@quieter/app/lib/query-persister";
import { describe, expect, test } from "vite-plus/test";

const getPersister = (options: { persister?: unknown }) => options.persister;

describe("query persistence allowlist", () => {
  test("persists unfiltered mailbox message lists only", () => {
    expect(getPersister(messagesQueryOptions("mailbox-a", "inbox"))).toBe(
      queryPersister.persisterFn
    );
    expect(getPersister(messagesQueryOptions("mailbox-a", "inbox", ""))).toBe(
      queryPersister.persisterFn
    );
    expect(
      getPersister(messagesQueryOptions("mailbox-a", "inbox", "from:alex"))
    ).toBeUndefined();
  });

  test("does not persist account-scoped mailbox navigation metadata", () => {
    expect(getPersister(mailboxesQueryOptions())).toBeUndefined();
    expect(shouldPersistQueryKey(["mailboxes"])).toBeFalsy();
  });

  test("persists mailbox-scoped label navigation metadata", () => {
    expect(getPersister(labelsQueryOptions("mailbox-a"))).toBe(
      queryPersister.persisterFn
    );
    expect(getPersister(managedLabelCountsQueryOptions("mailbox-a"))).toBe(
      queryPersister.persisterFn
    );
  });

  test("uses fresh mailbox metadata without a duplicate mount fetch", () => {
    expect(mailboxesQueryOptions().refetchOnMount).toBeFalsy();
  });

  test("persists opened threads but excludes managed rules", () => {
    expect(
      getPersister(getThreadWithDetailsOptions("mailbox-a", "thread-a"))
    ).toBe(queryPersister.persisterFn);
    expect(getPersister(managedRulesQueryOptions("mailbox-a"))).toBeUndefined();
  });

  test("matches manual persistence to the same metadata scope", () => {
    expect(
      shouldPersistQueryKey(["messages", "mailbox-a", "inbox", ""])
    ).toBeTruthy();
    expect(
      shouldPersistQueryKey(["messages", "mailbox-a", "inbox", "from:alex"])
    ).toBeFalsy();
  });

  test("rejects unrelated query scopes", () => {
    expect(
      shouldPersistQueryKey(["message-thread", 3, "mailbox-a", "thread-a"])
    ).toBeTruthy();
    expect(shouldPersistQueryKey(["mailboxes"])).toBeFalsy();
  });

  test("persists mailbox metadata scopes", () => {
    expect(shouldPersistQueryKey(["gmail-labels", "mailbox-a"])).toBeTruthy();
    expect(
      shouldPersistQueryKey(["managed-label-counts", "mailbox-a"])
    ).toBeTruthy();
  });
});
