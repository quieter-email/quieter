import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  prefetchMailboxSettingsDetail,
  prefetchOrganizationSettingsDetail,
  prefetchSettingsTab,
} from "./settings-prefetch";

const createQueryClient = () => {
  const queryClient = new QueryClient();
  const prefetchQuery = vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);
  return { prefetchQuery, queryClient };
};

describe("settings prefetch hierarchy", () => {
  test("warms only the shared mailbox dependencies for mailbox navigation", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchSettingsTab(queryClient, "mailboxes");

    expect(prefetchQuery).toHaveBeenCalledTimes(2);
    expect(prefetchQuery.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ["mailboxes"],
      ["user-billing"],
    ]);
  });

  test("bounds likely team detail warming to the selected team query", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchOrganizationSettingsDetail(queryClient, "team-one");

    expect(prefetchQuery).toHaveBeenCalledTimes(1);
    expect(prefetchQuery.mock.calls[0]?.[0].queryKey).toEqual([
      "auth",
      "organization",
      "team-one",
      "full",
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

    expect(prefetchQuery.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ["auth", "organization", "team-one", "full"],
      ["organization", "team-one", "divisions"],
      ["mail", "managed-mailbox-details", "managed-one"],
    ]);
  });
});
