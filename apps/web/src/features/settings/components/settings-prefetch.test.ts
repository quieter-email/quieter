import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";

import {
  prefetchMailboxSettingsDetail,
  prefetchOrganizationSettingsDetail,
  prefetchSettingsTab,
} from "./settings-prefetch";

const createQueryClient = () => {
  const queryClient = new QueryClient();
  const prefetchQuery = vi
    .spyOn(queryClient, "prefetchQuery")
    .mockResolvedValue();
  return { prefetchQuery, queryClient };
};

describe("settings prefetch hierarchy", () => {
  test("warms only the shared mailbox dependencies for mailbox navigation", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchSettingsTab(queryClient, "mailboxes");

    expect(
      new Set(prefetchQuery.mock.calls.map(([options]) => options.queryKey))
    ).toStrictEqual(new Set([["mailboxes"], ["user-billing"]]));
  });

  test("prefetches the team selected by navigation intent", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchOrganizationSettingsDetail(queryClient, "team-one");

    expect(
      prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    ).toStrictEqual([["auth", "organization", "team-one", "full"]]);
  });

  test("warms manager-only mailbox detail data without fetching it for private mailboxes", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchMailboxSettingsDetail(queryClient, {
      grantRole: null,
      id: "gmail-one",
      organizationId: "team-one",
      provider: "gmail",
    });
    expect(prefetchQuery).not.toHaveBeenCalled();

    await prefetchMailboxSettingsDetail(queryClient, {
      grantRole: "manager",
      id: "managed-one",
      organizationId: "team-one",
      provider: "managed",
    });

    expect(
      new Set(prefetchQuery.mock.calls.map(([options]) => options.queryKey))
    ).toStrictEqual(
      new Set([
        ["auth", "organization", "team-one", "full"],
        ["organization", "team-one", "divisions"],
        ["mail", "managed-mailbox-details", "managed-one"],
      ])
    );
  });
});
