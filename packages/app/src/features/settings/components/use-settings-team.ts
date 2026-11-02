import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import { useOrderedOrganizations } from "@quieter/app/lib/use-ordered-organizations";
import { useQuery } from "@tanstack/react-query";

export const useSettingsTeam = () => {
  const { organizationId, mailboxId, from } = settingsRouteApi.useSearch();
  const organizationsState = useOrderedOrganizations();
  const { data } = useQuery(mailboxesQueryOptions());
  const organizations = organizationsState.data ?? [];
  const mailbox = data?.groups
    .flatMap((group) => group.mailboxes)
    .find((item) => item.id === mailboxId);
  const contextMailboxId =
    new URL(from, "http://localhost").searchParams.get("mailboxId") ??
    data?.defaultMailboxId;
  const contextMailbox = data?.groups
    .flatMap((group) => group.mailboxes)
    .find((item) => item.id === contextMailboxId);
  const selectedId =
    mailbox?.organizationId ||
    organizationId ||
    contextMailbox?.organizationId ||
    organizations[0]?.id ||
    "";
  return {
    organizations,
    organizationsState,
    team: organizations.find((organization) => organization.id === selectedId),
    teamId: selectedId,
  };
};
