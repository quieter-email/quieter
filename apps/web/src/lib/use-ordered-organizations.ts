import { useQuery } from "@tanstack/react-query";

import { authClient } from "#/lib/auth";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";

export const useOrderedOrganizations = () => {
  const organizationsState = authClient.useListOrganizations();
  const { data } = useQuery(mailboxesQueryOptions());
  const teamPositionById = new Map(
    data?.groups.map((group, index) => [group.organizationId, index])
  );

  return {
    ...organizationsState,
    data: organizationsState.data?.toSorted((left, right) => {
      const positionDifference =
        (teamPositionById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (teamPositionById.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      return positionDifference || left.name.localeCompare(right.name);
    }),
  };
};
