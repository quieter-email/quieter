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

    expect(prefetchQuery).toHaveBeenCalledTimes(2);
    expect(
      prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    ).toStrictEqual([["mailboxes"], ["user-billing"]]);
  });

  test("keeps exact team intent prefetching as a deduplicated fallback", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchOrganizationSettingsDetail(queryClient, "team-one");

    expect(prefetchQuery).toHaveBeenCalledOnce();
    expect(prefetchQuery.mock.calls[0]?.[0].queryKey).toStrictEqual([
      "auth",
      "organization",
      "team-one",
      "full",
    ]);
  });

  test("warms only the default mailbox action list on actions intent", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();
    queryClient.setQueryData(["mailboxes"], {
      groups: [
        {
          mailboxes: [
            { id: "api-one", provider: "api" },
            { id: "gmail-one", provider: "gmail" },
            { id: "managed-one", provider: "managed" },
          ],
        },
      ],
    });

    await prefetchSettingsTab(queryClient, "actions");

    expect(
      prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    ).toStrictEqual([
      ["mailboxes"],
      ["connectors"],
      ["mailbox-actions", "gmail-one"],
    ]);
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
      prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    ).toStrictEqual([
      ["auth", "organization", "team-one", "full"],
      ["organization", "team-one", "divisions"],
      ["mail", "managed-mailbox-details", "managed-one"],
    ]);
  });
});
