import { queryOptions } from "@tanstack/react-query";
import { authClient } from "~/lib/auth";

export const ORGANIZATION_API_KEY_CONFIG_ID = "organization";

export const getOrganizationApiKeysQueryKey = (organizationId: string) =>
  ["organization-api-keys", organizationId] as const;

export const organizationApiKeysQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: async () => {
      const response = await authClient.apiKey.list({
        query: {
          configId: ORGANIZATION_API_KEY_CONFIG_ID,
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
    queryKey: getOrganizationApiKeysQueryKey(organizationId),
    staleTime: 30_000,
  });
