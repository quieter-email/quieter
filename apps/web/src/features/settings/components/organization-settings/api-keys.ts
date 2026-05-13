import { queryOptions } from "@tanstack/react-query";
import { authClient } from "~/lib/auth";

export const TEAM_API_KEY_CONFIG_ID = "team";

export const getTeamApiKeysQueryKey = (organizationId: string) =>
  ["team-api-keys", organizationId] as const;

export const teamApiKeysQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: async () => {
      const response = await authClient.apiKey.list({
        query: {
          configId: TEAM_API_KEY_CONFIG_ID,
          organizationId,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Could not load API keys.");
      }

      return response.data;
    },
    queryKey: getTeamApiKeysQueryKey(organizationId),
    staleTime: 30_000,
  });
