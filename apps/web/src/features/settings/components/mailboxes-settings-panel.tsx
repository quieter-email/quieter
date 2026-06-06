"use client";

import {
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextFieldInput,
  cn,
  toast,
} from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MailboxSettingsRow } from "~/features/navigation/components/mailbox-switcher";
import { organizationMailDomainsQueryOptions } from "~/features/settings/components/organization-settings/mail-domains";
import { authClient } from "~/lib/auth";
import { openGoogleAccountLink } from "~/lib/google-account-link";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

const getSettingsReturnTo = () => "/settings?tab=mailboxes";
const personalPlacementValue = "personal";

export const MailboxesSettingsPanel = () => {
  const queryClient = useQueryClient();
  const organizations = authClient.useListOrganizations().data ?? [];
  const [gmailOrganizationId, setGmailOrganizationId] = useState("");
  const [managedOrganizationId, setManagedOrganizationId] = useState("");
  const [managedLocalPart, setManagedLocalPart] = useState("");
  const [managedDomain, setManagedDomain] = useState<string | undefined>(undefined);
  const [isStartingGmail, setIsStartingGmail] = useState(false);
  const mailboxesQuery = useQuery(mailboxesQueryOptions());
  const groups = mailboxesQuery.data?.groups ?? [];
  const gmailGroups = groups.map((group) => ({
    ...group,
    mailboxes: group.mailboxes.filter((mailbox) => mailbox.provider === "gmail"),
  }));
  const managedGroups = groups.map((group) => ({
    ...group,
    mailboxes: group.mailboxes.filter((mailbox) => mailbox.provider === "managed"),
  }));
  const defaultMailboxId = mailboxesQuery.data?.defaultMailboxId ?? null;
  const placementItems = [
    { value: personalPlacementValue, label: "Personal" },
    ...organizations.map((organization) => ({
      value: organization.id,
      label: organization.name,
    })),
  ];
  const organizationItems = organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));
  const managedDomainsQuery = useQuery({
    ...organizationMailDomainsQueryOptions(managedOrganizationId),
    enabled: managedOrganizationId.length > 0,
  });
  const verifiedDomains = (managedDomainsQuery.data?.domains ?? []).filter(
    (domain) => domain.status === "verified",
  );
  const selectedDomain = managedDomain ?? verifiedDomains[0]?.domain ?? "";
  const trimmedLocalPart = managedLocalPart.trim();
  const invalidateMailboxes = async () => {
    await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
  };
  const disconnectMailboxMutation = useMutation({
    ...orpc.mail.disconnectMailbox.mutationOptions(),
    mutationKey: ["mail", "disconnect-mailbox"],
    onSuccess: invalidateMailboxes,
  });
  const moveGmailMailboxMutation = useMutation({
    ...orpc.mail.moveGmailMailbox.mutationOptions(),
    mutationKey: ["mail", "move-gmail-mailbox"],
    onSuccess: invalidateMailboxes,
  });
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    mutationKey: ["mail", "set-default-mailbox"],
    onSuccess: invalidateMailboxes,
  });
  const createManagedMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailbox.mutationOptions(),
    mutationKey: ["mail", "create-managed-mailbox"],
    onSuccess: async () => {
      setManagedLocalPart("");
      await invalidateMailboxes();
      toast.success("Managed mailbox created.");
    },
  });

  const startGmailConnection = async (input?: {
    mailboxId?: string;
    organizationId?: string | null;
  }) => {
    setIsStartingGmail(true);
    try {
      await openGoogleAccountLink({
        mailboxId: input?.mailboxId,
        organizationId:
          input?.organizationId === undefined ? gmailOrganizationId || null : input.organizationId,
        returnTo: getSettingsReturnTo(),
      });
    } catch (error) {
      setIsStartingGmail(false);
      toast.error(error instanceof Error ? error.message : "Could not start Gmail connection.");
    }
  };
  const getMutationErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Connected Gmail</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect an existing personal or Google Workspace inbox. Organization placement does not
            share the mailbox with other members.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            items={placementItems}
            onValueChange={(value) =>
              setGmailOrganizationId(value === personalPlacementValue ? "" : (value ?? ""))
            }
            value={gmailOrganizationId || personalPlacementValue}
          >
            <SelectTrigger aria-label="Gmail mailbox placement" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value={personalPlacementValue}>Personal</SelectItem>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={isStartingGmail}
            onClick={() => void startGmailConnection()}
            size="sm"
            type="button"
          >
            <HugeiconsIcon
              aria-hidden
              className={cn("size-4", { "animate-spin": isStartingGmail })}
              icon={isStartingGmail ? Loading03Icon : Mail01Icon}
            />
            {isStartingGmail ? "Opening Google" : "Connect Gmail"}
          </Button>
        </div>

        {mailboxesQuery.isError && (
          <p className="text-sm text-destructive">
            {mailboxesQuery.error.message ?? "Could not load mailboxes."}
          </p>
        )}

        {gmailGroups.map((group) => (
          <div className="space-y-2" key={group.id}>
            <p className="text-xs text-muted-foreground">{group.name}</p>
            <div className="divide-y divide-border/70">
              {group.mailboxes.map((mailbox) => {
                const isDefault = mailbox.id === defaultMailboxId;
                return (
                  <MailboxSettingsRow
                    action={
                      <div className="flex items-center gap-1">
                        <Button
                          aria-label={
                            isDefault ? "Unset default mailbox" : "Set as default mailbox"
                          }
                          className={cn({
                            "text-foreground": isDefault,
                            "text-muted-foreground": !isDefault,
                          })}
                          disabled={setDefaultMailboxMutation.isPending}
                          onClick={() => {
                            setDefaultMailboxMutation.mutate(
                              {
                                mailboxId: isDefault ? null : mailbox.id,
                              },
                              {
                                onError: (error) => {
                                  toast.error(
                                    getMutationErrorMessage(
                                      error,
                                      "Could not update default mailbox.",
                                    ),
                                  );
                                },
                              },
                            );
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4"
                            icon={isDefault ? PinIcon : PinOffIcon}
                          />
                          {isDefault ? "Default" : "Set default"}
                        </Button>

                        <>
                          <Select
                            disabled={moveGmailMailboxMutation.isPending}
                            items={placementItems}
                            onValueChange={(value) => {
                              moveGmailMailboxMutation.mutate(
                                {
                                  mailboxId: mailbox.id,
                                  organizationId: value === personalPlacementValue ? null : value,
                                },
                                {
                                  onError: (error) => {
                                    toast.error(
                                      getMutationErrorMessage(error, "Could not move mailbox."),
                                    );
                                  },
                                },
                              );
                            }}
                            value={mailbox.organizationId ?? personalPlacementValue}
                          >
                            <SelectTrigger
                              aria-label={`Placement for ${mailbox.emailAddress}`}
                              size="sm"
                              variant="ghost"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value={personalPlacementValue}>Personal</SelectItem>
                              {organizations.map((organization) => (
                                <SelectItem key={organization.id} value={organization.id}>
                                  {organization.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {mailbox.connectionStatus === "needs_reconnect" && (
                            <Button
                              disabled={isStartingGmail}
                              onClick={() =>
                                void startGmailConnection({
                                  mailboxId: mailbox.id,
                                  organizationId: mailbox.organizationId,
                                })
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Reconnect
                            </Button>
                          )}
                          <Button
                            disabled={disconnectMailboxMutation.isPending}
                            onClick={() => {
                              disconnectMailboxMutation.mutate(
                                {
                                  mailboxId: mailbox.id,
                                },
                                {
                                  onError: (error) => {
                                    toast.error(
                                      getMutationErrorMessage(error, "Could not remove mailbox."),
                                    );
                                  },
                                },
                              );
                            }}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                            Remove
                          </Button>
                        </>
                      </div>
                    }
                    key={mailbox.id}
                    mailbox={mailbox}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="text-sm font-medium text-foreground">Shared inbox</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a mailbox your organization can access.
          </p>
        </div>
        {organizations.length > 0 ? (
          <div className="flex flex-wrap items-end gap-3">
            <Select
              items={organizationItems}
              onValueChange={(value) => {
                setManagedOrganizationId(value ?? "");
                setManagedDomain(undefined);
              }}
              value={managedOrganizationId}
            >
              <SelectTrigger aria-label="Managed mailbox organization" className="w-48">
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent align="start">
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="squircle flex h-9 w-72 items-center rounded-md border border-input bg-background shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
              <TextFieldInput
                aria-label="Mailbox address"
                chrome="ghost"
                className="h-full min-w-0 flex-1 pr-1"
                onChange={(event) =>
                  setManagedLocalPart(event.currentTarget.value.replace(/[@\s]/g, ""))
                }
                placeholder="support"
                value={managedLocalPart}
              />
              <span aria-hidden className="text-sm text-muted-foreground select-none">
                @
              </span>
              {verifiedDomains.length > 0 ? (
                <Select
                  items={verifiedDomains.map((domain) => ({
                    value: domain.domain,
                    label: domain.domain,
                  }))}
                  onValueChange={(value) => setManagedDomain(value ?? undefined)}
                  value={selectedDomain}
                >
                  <SelectTrigger
                    aria-label="Mailbox domain"
                    className="h-full rounded-l-none pr-2.5 pl-1.5 shadow-none active:scale-100"
                    size="sm"
                    variant="ghost"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {verifiedDomains.map((domain) => (
                      <SelectItem key={domain.id} value={domain.domain}>
                        {domain.domain}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="px-2.5 text-sm text-muted-foreground">
                  {!managedOrganizationId
                    ? "domain"
                    : managedDomainsQuery.isLoading
                      ? "loading…"
                      : "no verified domain"}
                </span>
              )}
            </div>

            <Button
              disabled={
                !trimmedLocalPart ||
                !selectedDomain ||
                !managedOrganizationId ||
                createManagedMailboxMutation.isPending
              }
              onClick={() => {
                createManagedMailboxMutation.mutate(
                  {
                    emailAddress: `${trimmedLocalPart}@${selectedDomain}`,
                    organizationId: managedOrganizationId,
                  },
                  {
                    onError: (error) => {
                      toast.error(
                        getMutationErrorMessage(error, "Could not create managed mailbox."),
                      );
                    },
                  },
                );
              }}
              size="sm"
              type="button"
            >
              Create Managed mailbox
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Create an organization before creating a Managed mailbox.
          </p>
        )}
        {organizations.length > 0 &&
          managedOrganizationId.length > 0 &&
          !managedDomainsQuery.isLoading &&
          verifiedDomains.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This organization has no verified domain yet. Add and verify one in the organization
              settings to create a shared inbox.
            </p>
          )}
        {createManagedMailboxMutation.isError && (
          <p className="text-sm text-destructive">
            {createManagedMailboxMutation.error.message ?? "Could not create managed mailbox."}
          </p>
        )}
        {managedGroups.map((group) =>
          group.mailboxes.length > 0 ? (
            <div className="space-y-2" key={group.id}>
              <p className="text-xs text-muted-foreground">{group.name}</p>
              <div className="divide-y divide-border/70">
                {group.mailboxes.map((mailbox) => (
                  <MailboxSettingsRow
                    action={
                      <span className="text-xs text-muted-foreground capitalize">
                        {mailbox.grantRole}
                      </span>
                    }
                    key={mailbox.id}
                    mailbox={mailbox}
                  />
                ))}
              </div>
            </div>
          ) : null,
        )}
      </section>
    </div>
  );
};
