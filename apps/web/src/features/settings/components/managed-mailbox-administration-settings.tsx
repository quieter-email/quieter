"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authClient } from "#/lib/auth";
import { toastError } from "#/lib/error-toast";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import { ManagedMailboxAccessSection } from "./managed-mailbox-detail-settings";
import { managedMailboxSettingsQueryOptions } from "./managed-mailbox-settings-query";
import {
  fullOrganizationQueryOptions,
  hasOrganizationRole,
} from "./organization-settings/domain";
import { SettingsSection } from "./settings-layout";

const TeamMailboxAdministration = ({
  organizationId,
  organizationName,
  userId,
}: {
  organizationId: string;
  organizationName: string;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const { data: team } = useQuery(fullOrganizationQueryOptions(organizationId));
  const membership = team?.members.find((member) => member.userId === userId);
  const canManage =
    membership !== undefined &&
    (hasOrganizationRole(membership.role, "owner") ||
      hasOrganizationRole(membership.role, "admin"));
  const administrationOptions =
    orpc.mail.listManagedMailboxAdministration.queryOptions({
      input: { organizationId },
    });
  const { data: administration, isError } = useQuery({
    ...administrationOptions,
    enabled: canManage,
  });
  const detailsOptions = managedMailboxSettingsQueryOptions(mailboxId ?? "");
  const { data: details, isError: isDetailsError } = useQuery({
    ...detailsOptions,
    enabled: canManage && mailboxId !== null,
  });
  const changeAccess = useMutation({
    ...orpc.mail.setManagedMailboxAccessMode.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-access-mode", mailboxId],
    onError: (error) => {
      toastError(error, {
        boundary: "mailbox-settings",
        fallback: "Could not change mailbox access.",
      });
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: administrationOptions.queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: managedMailboxSettingsQueryOptions(input.mailboxId)
            .queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() }),
      ]);
    },
  });
  if (!canManage) {
    return null;
  }
  const mailboxes = administration?.mailboxes ?? [];
  if (mailboxes.length === 0 && !isError) {
    return null;
  }
  return (
    <SettingsSection
      title={`${organizationName} mailbox administration`}
      description="Manage ownership without opening anyone's mail."
    >
      {isError ? (
        <p className="text-body text-destructive">
          Could not load team mailboxes.
        </p>
      ) : (
        <Select
          items={mailboxes.map((mailbox) => ({
            label: mailbox.emailAddress,
            value: mailbox.id,
          }))}
          value={mailboxId}
          onValueChange={setMailboxId}
        >
          <SelectTrigger aria-label={`${organizationName} mailbox to manage`}>
            <SelectValue placeholder="Choose a mailbox" />
          </SelectTrigger>
          <SelectContent>
            {mailboxes.map((mailbox) => (
              <SelectItem key={mailbox.id} value={mailbox.id}>
                {mailbox.emailAddress},{" "}
                {mailbox.accessMode === "private" ? "Private" : "Shared"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {isDetailsError && (
        <p className="text-body text-destructive">
          Could not load mailbox access.
        </p>
      )}
      {details !== undefined && mailboxId !== null && (
        <ManagedMailboxAccessSection
          canMakePrivate
          detailManagedMembers={team?.members ?? []}
          details={details}
          isAccessModePending={changeAccess.isPending}
          key={mailboxId}
          onAccessModeChange={(input) => {
            changeAccess.mutate({ ...input, mailboxId });
          }}
        />
      )}
    </SettingsSection>
  );
};

export const ManagedMailboxAdministrationSettings = () => {
  const organizations = authClient.useListOrganizations().data ?? [];
  const session = authClient.useSession().data;
  if (session === null || session === undefined) {
    return null;
  }
  return organizations.map((organization) => (
    <TeamMailboxAdministration
      key={organization.id}
      organizationId={organization.id}
      organizationName={organization.name}
      userId={session.user.id}
    />
  ));
};
