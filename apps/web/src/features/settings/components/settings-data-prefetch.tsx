"use client";

import { usePrefetchQuery, useQuery } from "@tanstack/react-query";
import { authClient } from "~/lib/auth";
import { connectorsQueryOptions } from "~/lib/connectors-query";
import {
  linearMetadataQueryOptions,
  mailboxActionQueryOptions,
  mailboxActionsListQueryOptions,
} from "~/lib/mailbox-actions-query";
import { mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { type UserBillingOverview, userBillingQueryOptions } from "../domain/billing";
import { managedMailboxSettingsQueryOptions } from "./managed-mailbox-settings-query";
import { organizationApiKeysQueryOptions } from "./organization-settings/api-keys";
import { organizationDivisionsQueryOptions } from "./organization-settings/divisions-query";
import {
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
  userInvitationsQueryOptions,
} from "./organization-settings/domain";
import {
  organizationDomainConnectQueryOptions,
  organizationMailDomainQueryOptions,
  organizationMailDomainsQueryOptions,
} from "./organization-settings/mail-domains";
import { organizationMailUsageQueryOptions } from "./organization-settings/organization-mail-usage-query";

const LinearMetadataPrefetch = ({ credentialId }: { credentialId: string }) => {
  usePrefetchQuery(linearMetadataQueryOptions(credentialId));
  return null;
};

const ActionDetailPrefetch = ({ actionId }: { actionId: string }) => {
  const { data } = useQuery(mailboxActionQueryOptions(actionId));
  const credentialIds = new Set<string>();

  for (const revision of data?.revisions ?? []) {
    if (!revision.graph || typeof revision.graph !== "object") continue;
    const nodes = (revision.graph as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) continue;

    for (const node of nodes) {
      if (!node || typeof node !== "object" || !("config" in node)) continue;
      const config = node.config;
      if (!config || typeof config !== "object" || !("credentialId" in config)) continue;
      if (typeof config.credentialId === "string" && config.credentialId) {
        credentialIds.add(config.credentialId);
      }
    }
  }

  return [...credentialIds].map((credentialId) => (
    <LinearMetadataPrefetch credentialId={credentialId} key={credentialId} />
  ));
};

const MailboxActionsPrefetch = ({ mailboxId }: { mailboxId: string }) => {
  const { data } = useQuery(mailboxActionsListQueryOptions(mailboxId));

  return data?.actions.map((action) => (
    <ActionDetailPrefetch actionId={action.id} key={action.id} />
  ));
};

const ManagedMailboxDetailPrefetch = ({
  mailboxId,
  organizationId,
}: {
  mailboxId: string;
  organizationId: string;
}) => {
  usePrefetchQuery(fullOrganizationQueryOptions(organizationId));
  usePrefetchQuery(organizationDivisionsQueryOptions(organizationId));
  usePrefetchQuery(managedMailboxSettingsQueryOptions(mailboxId));
  return null;
};

const DomainDetailPrefetch = ({
  domainId,
  organizationId,
}: {
  domainId: string;
  organizationId: string;
}) => {
  usePrefetchQuery(organizationMailDomainQueryOptions(organizationId, domainId));
  usePrefetchQuery(organizationDomainConnectQueryOptions(organizationId, domainId));
  return null;
};

const OrganizationPaidDataPrefetch = ({
  canManage,
  organizationId,
}: {
  canManage: boolean;
  organizationId: string;
}) => {
  const { data: domains } = useQuery(organizationMailDomainsQueryOptions(organizationId));
  usePrefetchQuery(organizationApiKeysQueryOptions(organizationId));

  return (
    <>
      {canManage ? <OrganizationMailUsagePrefetch organizationId={organizationId} /> : null}
      {domains?.domains.map((domain) => (
        <DomainDetailPrefetch
          domainId={domain.id}
          key={domain.id}
          organizationId={organizationId}
        />
      ))}
    </>
  );
};

const OrganizationMailUsagePrefetch = ({ organizationId }: { organizationId: string }) => {
  usePrefetchQuery(organizationMailUsageQueryOptions(organizationId));
  return null;
};

const OrganizationDataPrefetch = ({
  billing,
  organizationId,
  userId,
}: {
  billing: UserBillingOverview | undefined;
  organizationId: string;
  userId: string;
}) => {
  const { data: organization } = useQuery(fullOrganizationQueryOptions(organizationId));
  usePrefetchQuery(organizationDivisionsQueryOptions(organizationId));
  const activeMember = organization?.members.find((member) => member.userId === userId);
  const role = activeMember ? normalizeOrganizationRole(activeMember.role) : null;
  const canManage = hasOrganizationPermission(role, { organization: ["update"] });
  const hasPaidAccess =
    billing?.teams.some((team) => team.organizationId === organizationId && team.hasAccess) ===
    true;

  return hasPaidAccess ? (
    <OrganizationPaidDataPrefetch canManage={canManage} organizationId={organizationId} />
  ) : null;
};

const UserInvitationsPrefetch = ({ userId }: { userId: string }) => {
  usePrefetchQuery(userInvitationsQueryOptions(userId));
  return null;
};

export const SettingsDataPrefetch = () => {
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  authClient.useListPasskeys();
  const { data: billing } = useQuery(userBillingQueryOptions());
  const { data: mailboxes } = useQuery(mailboxesQueryOptions());
  usePrefetchQuery(connectorsQueryOptions());
  usePrefetchQuery(orpc.ai.settings.queryOptions());

  const userId = session.data?.user.id;
  const allMailboxes = mailboxes?.groups.flatMap((group) => group.mailboxes) ?? [];

  return (
    <>
      {userId ? <UserInvitationsPrefetch userId={userId} /> : null}
      {userId
        ? organizations.data?.map((organization) => (
            <OrganizationDataPrefetch
              billing={billing}
              key={organization.id}
              organizationId={organization.id}
              userId={userId}
            />
          ))
        : null}
      {allMailboxes.map((mailbox) =>
        mailbox.provider === "gmail" || mailbox.provider === "managed" ? (
          <MailboxActionsPrefetch key={`actions:${mailbox.id}`} mailboxId={mailbox.id} />
        ) : null,
      )}
      {allMailboxes.map((mailbox) =>
        mailbox.provider === "managed" && mailbox.grantRole === "manager" ? (
          <ManagedMailboxDetailPrefetch
            key={`settings:${mailbox.id}`}
            mailboxId={mailbox.id}
            organizationId={mailbox.organizationId}
          />
        ) : null,
      )}
    </>
  );
};
