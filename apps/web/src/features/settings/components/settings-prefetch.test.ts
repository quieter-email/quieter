import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";

import {
  prefetchMailboxSettingsDetail,
  prefetchOrganizationSettingsDetail,
} from "./settings-prefetch";

const createQueryClient = () => {
  const queryClient = new QueryClient();
  const prefetchQuery = vi
    .spyOn(queryClient, "prefetchQuery")
    .mockResolvedValue();
  return { prefetchQuery, queryClient };
};

describe("settings prefetch hierarchy", () => {
  test("prefetches the team selected by navigation intent", async () => {
    const { prefetchQuery, queryClient } = createQueryClient();

    await prefetchOrganizationSettingsDetail(queryClient, "team-one");

    expect(
      prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    ).toContainEqual(["auth", "organization", "team-one", "full"]);
  });

  test("skips mailbox detail prefetch for private mailboxes", async () => {
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

    expect(prefetchQuery).toHaveBeenCalled();
  });
});
