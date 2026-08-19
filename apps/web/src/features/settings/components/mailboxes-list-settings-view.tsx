"use client";

import {
  Add01Icon,
  Loading03Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  getMailboxDisplayTitle,
  getProviderLabel,
  getSettingsReturnTo,
  hasTrimmedDisplayName,
  runDetached,
  showMutationError,
} from "#/features/settings/components/mailboxes-settings-shared";
import { organizationDivisionsQueryOptions } from "#/features/settings/components/organization-settings/divisions-query";
import {
  fullOrganizationQueryOptions,
  hasOrganizationRole,
} from "#/features/settings/components/organization-settings/domain";
import {
  organizationMailDomainsQueryOptions,
  resolveMailDomainVerified,
} from "#/features/settings/components/organization-settings/mail-domains";
import {
  SettingsCard,
  SettingsErrorState,
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
  SettingsSection,
} from "#/features/settings/components/settings-layout";
import { prefetchMailboxSettingsDetail } from "#/features/settings/components/settings-prefetch";
import { authClient } from "#/lib/auth";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import {
  getMailboxesQueryKey,
  mailboxesQueryOptions,
} from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

type MailboxGroup = RouterOutputs["mail"]["listMailboxes"]["groups"][number];

const getMailboxRowMeta = (
  mailboxId: string,
  defaultMailboxId: string | null,
  connectionStatus: string
) => {
  if (connectionStatus === "needs_reconnect") {
    return <span className="text-destructive">Reconnect</span>;
  }
  if (mailboxId === defaultMailboxId) {
    return <span>Default</span>;
  }
  return null;
};

const getMailboxRowDescription = (
  displayName: string | null | undefined,
  emailAddress: string,
  provider: string,
  grantRole: string | null | undefined
) => {
  const parts: (string | null)[] = [
    hasTrimmedDisplayName(displayName) ? emailAddress : null,
    getProviderLabel(provider),
    provider === "managed" && (grantRole ?? "") !== ""
      ? `${grantRole} access`
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(", ");
};

const MailboxesListContent = ({
  defaultMailboxId,
  groups,
  onNavigateToMailbox,
  queryClient,
}: {
  defaultMailboxId: string | null;
  groups: MailboxGroup[];
  onNavigateToMailbox: (mailboxId: string) => Promise<void>;
  queryClient: QueryClient;
}) => {
  if (groups.length === 0) {
    return (
      <SettingsCard className="p-6">
        <p className="text-body text-fg">No mailboxes yet</p>
        <p className="mt-1 text-body/6 text-muted-fg">
          Connect Gmail or create a shared inbox to start using Quieter.
        </p>
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div className="space-y-2" key={group.id}>
          <p className="px-1 text-caption text-muted-fg">{group.name}</p>
          <SettingsRows>
            {group.mailboxes.map((mailbox) => (
              <SettingsNavigationRow
                description={getMailboxRowDescription(
                  mailbox.displayName,
                  mailbox.emailAddress,
                  mailbox.provider,
                  mailbox.grantRole
                )}
                key={mailbox.id}
                meta={getMailboxRowMeta(
                  mailbox.id,
                  defaultMailboxId,
                  mailbox.connectionStatus
                )}
                onClick={() => {
                  runDetached(async () => {
                    await onNavigateToMailbox(mailbox.id);
                  });
                }}
                onIntent={() => {
                  runDetached(async () => {
                    await prefetchMailboxSettingsDetail(queryClient, mailbox);
                  });
                }}
                title={getMailboxDisplayTitle(
                  mailbox.displayName,
                  mailbox.emailAddress
                )}
              />
            ))}
          </SettingsRows>
        </div>
      ))}
    </div>
  );
};

const AddMailboxDialog = ({
  canCreateManagedMailbox,
  createManagedMailboxMutation,
  gmailOrganizationId,
  isAddMailboxOpen,
  isCreateManagedOrganizationPending,
  isStartingGmail,
  managedDisplayName,
  managedDivisionId,
  managedDivisionsData,
  managedLocalPart,
  onGmailOrganizationChange,
  onManagedDisplayNameChange,
  onManagedDivisionChange,
  onManagedDomainChange,
  onManagedLocalPartChange,
  onManagedOrganizationChange,
  onOpenChange,
  onStartGmailConnection,
  organizations,
  placementItems,
  selectedDomain,
  selectedManagedOrganization,
  selectedManagedOrganizationId,
  trimmedLocalPart,
  verifiedDomains,
  areManagedDomainsLoading,
}: {
  areManagedDomainsLoading: boolean;
  canCreateManagedMailbox: boolean;
  createManagedMailboxMutation: {
    error: Error | null;
    isError: boolean;
    isPending: boolean;
    mutate: (
      variables: {
        displayName: string;
        divisionId: string | null;
        emailAddress: string;
        organizationId: string;
      },
      options?: { onError?: (error: unknown) => void }
    ) => void;
  };
  gmailOrganizationId: string;
  isAddMailboxOpen: boolean;
  isCreateManagedOrganizationPending: boolean;
  isStartingGmail: boolean;
  managedDisplayName: string;
  managedDivisionId: string | null;
  managedDivisionsData:
    | { divisions: { id: string; name: string }[] }
    | undefined;
  managedLocalPart: string;
  onGmailOrganizationChange: (value: string) => void;
  onManagedDisplayNameChange: (value: string) => void;
  onManagedDivisionChange: (value: string | null) => void;
  onManagedDomainChange: (value: string | undefined) => void;
  onManagedLocalPartChange: (value: string) => void;
  onManagedOrganizationChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onStartGmailConnection: () => Promise<void>;
  organizations: { id: string; name: string }[];
  placementItems: { label: string; value: string }[];
  selectedDomain: string;
  selectedManagedOrganization: { name: string } | undefined;
  selectedManagedOrganizationId: string;
  trimmedLocalPart: string;
  verifiedDomains: { domain: string; id: string }[];
}) => {
  const renderManagedInboxForm = () => {
    if (isCreateManagedOrganizationPending) {
      return (
        <p className="squircle rounded-md border border-border bg-muted/15 px-3 py-2 text-caption/5 text-muted-fg">
          Checking your team access…
        </p>
      );
    }

    if (!canCreateManagedMailbox) {
      return (
        <p className="squircle rounded-md border border-border bg-muted/15 px-3 py-2 text-caption/5 text-muted-fg">
          Only a team owner or admin can create a shared inbox for this team.
        </p>
      );
    }

    return (
      <>
        <TextFieldInput
          aria-label="Shared inbox display name"
          onChange={(event) => {
            onManagedDisplayNameChange(event.currentTarget.value);
          }}
          placeholder="Display name, such as Support"
          value={managedDisplayName}
        />
        <div className="squircle flex h-9 min-w-0 items-center rounded-md border border-border bg-bg-elevated shadow-sm transition-colors">
          <TextFieldInput
            aria-label="Mailbox address"
            chrome="ghost"
            className="h-full min-w-0 flex-1 pr-1"
            onChange={(event) => {
              onManagedLocalPartChange(
                event.currentTarget.value.replaceAll(/[@\s]/gu, "")
              );
            }}
            placeholder="support"
            value={managedLocalPart}
          />
          <span aria-hidden className="text-body text-muted-fg select-none">
            @
          </span>
          {verifiedDomains.length > 0 ? (
            <Select
              items={verifiedDomains.map((domain) => ({
                label: domain.domain,
                value: domain.domain,
              }))}
              onValueChange={(value) => {
                onManagedDomainChange(value ?? undefined);
              }}
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
            <span className="px-2.5 text-body text-muted-fg">
              {areManagedDomainsLoading ? "loading…" : "no receiving domain"}
            </span>
          )}
        </div>
        <Select
          items={[
            { label: "No primary division", value: "none" },
            ...(managedDivisionsData?.divisions ?? []).map((division) => ({
              label: division.name,
              value: division.id,
            })),
          ]}
          onValueChange={(value) => {
            onManagedDivisionChange(value === "none" ? null : (value ?? null));
          }}
          value={managedDivisionId ?? "none"}
        >
          <SelectTrigger aria-label="Primary division">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="none">No primary division</SelectItem>
            {(managedDivisionsData?.divisions ?? []).map((division) => (
              <SelectItem key={division.id} value={division.id}>
                {division.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {verifiedDomains.length === 0 && !areManagedDomainsLoading && (
          <p className="text-caption/5 text-muted-fg">
            Add and verify a send-and-receive domain in{" "}
            {selectedManagedOrganization?.name ?? "team"} settings before
            creating a shared inbox.
          </p>
        )}
        {createManagedMailboxMutation.isError && (
          <p className="text-body text-destructive">
            {createManagedMailboxMutation.error?.message ??
              "Could not create shared inbox."}
          </p>
        )}
        <Button
          disabled={
            trimmedLocalPart === "" ||
            selectedDomain === "" ||
            createManagedMailboxMutation.isPending
          }
          onClick={() => {
            createManagedMailboxMutation.mutate(
              {
                displayName: managedDisplayName,
                divisionId: managedDivisionId,
                emailAddress: `${trimmedLocalPart}@${selectedDomain}`,
                organizationId: selectedManagedOrganizationId,
              },
              {
                onError: showMutationError("Could not create shared inbox."),
              }
            );
          }}
          type="button"
        >
          Create shared inbox
        </Button>
      </>
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={isAddMailboxOpen}>
      <DialogContent className="w-[min(92vw,36rem)]">
        <DialogHeader>
          <DialogTitle>Add mailbox</DialogTitle>
          <DialogDescription>
            Connect Gmail for yourself or create a shared inbox for a team.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-6">
          <div className="space-y-3">
            <div>
              <p className="text-body text-fg">Gmail</p>
              <p className="mt-1 text-caption/5 text-muted-fg">
                Choose the team where this private mailbox should appear.
              </p>
            </div>
            <div className="flex flex-col gap-2 @sm:flex-row">
              <Select
                items={placementItems}
                onValueChange={(value) => {
                  onGmailOrganizationChange(value ?? "");
                }}
                value={gmailOrganizationId || organizations[0]?.id}
              >
                <SelectTrigger
                  aria-label="Gmail mailbox placement"
                  className="flex-1"
                >
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent align="start">
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={isStartingGmail || organizations.length === 0}
                onClick={() => {
                  runDetached(async () => {
                    await onStartGmailConnection();
                  });
                }}
                pending={isStartingGmail}
                pendingLabel="Connecting…"
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
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <div>
              <p className="text-body text-fg">Shared inbox</p>
              <p className="mt-1 text-caption/5 text-muted-fg">
                Team owners and admins can create an address on a verified
                domain with incoming mail enabled.
              </p>
            </div>
            <Select
              items={placementItems}
              onValueChange={(value) => {
                onManagedOrganizationChange(value ?? "");
              }}
              value={selectedManagedOrganizationId || null}
            >
              <SelectTrigger aria-label="Shared inbox team">
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent align="start">
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {renderManagedInboxForm()}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton>Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const MailboxesListSettingsView = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const session = authClient.useSession().data;
  const organizations = authClient.useListOrganizations().data ?? [];
  const [isAddMailboxOpen, setIsAddMailboxOpen] = useState(false);
  const [gmailOrganizationId, setGmailOrganizationId] = useState("");
  const [managedOrganizationId, setManagedOrganizationId] = useState("");
  const [managedDisplayName, setManagedDisplayName] = useState("");
  const [managedDivisionId, setManagedDivisionId] = useState<string | null>(
    null
  );
  const [managedLocalPart, setManagedLocalPart] = useState("");
  const [managedDomain, setManagedDomain] = useState<string>();
  const [isStartingGmail, setIsStartingGmail] = useState(false);
  const {
    data: mailboxesData,
    error: mailboxesError,
    isError: isMailboxesError,
    isPending: areMailboxesPending,
    refetch: refetchMailboxes,
  } = useQuery(mailboxesQueryOptions());
  const groups = mailboxesData?.groups ?? [];
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const selectedManagedOrganizationId =
    managedOrganizationId || organizations[0]?.id || "";
  const selectedManagedOrganization = organizations.find(
    (organization) => organization.id === selectedManagedOrganizationId
  );
  const placementItems = organizations.map((organization) => ({
    label: organization.name,
    value: organization.id,
  }));
  const { data: managedDomainsData, isLoading: areManagedDomainsLoading } =
    useQuery({
      ...organizationMailDomainsQueryOptions(selectedManagedOrganizationId),
      enabled: isAddMailboxOpen && selectedManagedOrganizationId.length > 0,
    });
  const {
    data: createManagedOrganization,
    isPending: isCreateManagedOrganizationPending,
  } = useQuery({
    ...fullOrganizationQueryOptions(selectedManagedOrganizationId),
    enabled: isAddMailboxOpen && selectedManagedOrganizationId.length > 0,
  });
  const { data: managedDivisionsData } = useQuery({
    ...organizationDivisionsQueryOptions(selectedManagedOrganizationId),
    enabled: isAddMailboxOpen && selectedManagedOrganizationId.length > 0,
  });
  const verifiedDomains = (managedDomainsData?.domains ?? []).filter(
    (domain) =>
      resolveMailDomainVerified(domain) && domain.mode === "send_and_receive"
  );
  const selectedDomain = managedDomain ?? verifiedDomains[0]?.domain ?? "";
  const trimmedLocalPart = managedLocalPart.trim();
  const createManagedMember = createManagedOrganization?.members.find(
    (member) => member.userId === session?.user.id
  );
  const canCreateManagedMailbox =
    createManagedMember !== undefined &&
    (hasOrganizationRole(createManagedMember.role, "owner") ||
      hasOrganizationRole(createManagedMember.role, "admin"));

  const navigateToMailbox = async (nextMailboxId: string) => {
    await navigate({
      search: (previous) => ({
        ...previous,
        mailboxId: nextMailboxId,
        tab: "mailboxes",
      }),
      to: ".",
    });
  };
  const invalidateMailboxes = async () => {
    await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
  };
  const createManagedMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailbox.mutationOptions(),
    mutationKey: ["mail", "create-managed-mailbox"],
    onSuccess: async ({ mailboxId: createdMailboxId }) => {
      setManagedLocalPart("");
      setManagedDisplayName("");
      setManagedDivisionId(null);
      setIsAddMailboxOpen(false);
      await invalidateMailboxes();
      toast.success("Shared inbox created.");
      await navigateToMailbox(createdMailboxId);
    },
  });

  const startGmailConnection = async () => {
    setIsStartingGmail(true);
    try {
      await openGoogleAccountLink({
        organizationId: gmailOrganizationId || organizations[0]?.id,
        queryClient,
        returnTo: getSettingsReturnTo(),
      });
    } catch (error) {
      setIsStartingGmail(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start Gmail connection."
      );
    }
  };

  const renderMailboxSection = () => {
    if (isMailboxesError) {
      return (
        <SettingsErrorState
          message={mailboxesError.message ?? "Could not load mailboxes."}
          onRetry={() => {
            runDetached(async () => {
              await refetchMailboxes();
            });
          }}
        />
      );
    }

    if (areMailboxesPending) {
      return <SettingsLoadingState label="Loading mailboxes" />;
    }

    return (
      <MailboxesListContent
        defaultMailboxId={defaultMailboxId}
        groups={groups}
        onNavigateToMailbox={navigateToMailbox}
        queryClient={queryClient}
      />
    );
  };

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        action={
          <Button
            onClick={() => {
              setIsAddMailboxOpen(true);
            }}
            size="sm"
            type="button"
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
            Add mailbox
          </Button>
        }
        title="Mailboxes"
      >
        Connect personal mail and manage the shared inboxes you can access.
      </SettingsPageHeader>

      <SettingsSection title="Your mailboxes">
        {renderMailboxSection()}
      </SettingsSection>

      <AddMailboxDialog
        areManagedDomainsLoading={areManagedDomainsLoading}
        canCreateManagedMailbox={canCreateManagedMailbox}
        createManagedMailboxMutation={createManagedMailboxMutation}
        gmailOrganizationId={gmailOrganizationId}
        isAddMailboxOpen={isAddMailboxOpen}
        isCreateManagedOrganizationPending={isCreateManagedOrganizationPending}
        isStartingGmail={isStartingGmail}
        managedDisplayName={managedDisplayName}
        managedDivisionId={managedDivisionId}
        managedDivisionsData={managedDivisionsData}
        managedLocalPart={managedLocalPart}
        onGmailOrganizationChange={setGmailOrganizationId}
        onManagedDisplayNameChange={setManagedDisplayName}
        onManagedDivisionChange={setManagedDivisionId}
        onManagedDomainChange={setManagedDomain}
        onManagedLocalPartChange={setManagedLocalPart}
        onManagedOrganizationChange={(value) => {
          setManagedOrganizationId(value);
          setManagedDomain(undefined);
          setManagedDivisionId(null);
        }}
        onOpenChange={setIsAddMailboxOpen}
        onStartGmailConnection={startGmailConnection}
        organizations={organizations}
        placementItems={placementItems}
        selectedDomain={selectedDomain}
        selectedManagedOrganization={selectedManagedOrganization}
        selectedManagedOrganizationId={selectedManagedOrganizationId}
        trimmedLocalPart={trimmedLocalPart}
        verifiedDomains={verifiedDomains}
      />
    </div>
  );
};
