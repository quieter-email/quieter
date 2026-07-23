"use client";

import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  MailboxAccessPill,
  type MailboxGrantRole,
} from "~/features/mailbox/components/mailbox-access-pill";
import {
  fullOrganizationQueryOptions,
  hasOrganizationRole,
} from "~/features/settings/components/organization-settings/domain";
import { organizationMailDomainsQueryOptions } from "~/features/settings/components/organization-settings/mail-domains";
import {
  settingsInsetRowClass,
  SettingsCard,
  SettingsInsetRows,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "~/features/settings/components/settings-layout";
import {
  hasOrganizationAiAccess,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { authClient } from "~/lib/auth";
import { openGoogleAccountLink } from "~/lib/google-account-link";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc, rpc } from "~/lib/orpc";
import { settingsRouteApi } from "~/lib/route-apis";

const getSettingsReturnTo = (mailboxId?: string) =>
  `/settings?tab=mailboxes${mailboxId ? `&mailboxId=${encodeURIComponent(mailboxId)}` : ""}`;
const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const mailboxGrantRoleOptions = [
  { value: "reader", label: "Reader" },
  { value: "responder", label: "Responder" },
  { value: "manager", label: "Manager" },
] as const;
const mailboxGrantSelectItems = [{ value: "none", label: "No access" }, ...mailboxGrantRoleOptions];
const switchClassName =
  "h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary";

const getProviderLabel = (provider: string) => {
  if (provider === "gmail") return "Gmail";
  if (provider === "managed") return "Shared inbox";
  return "Send-only mailbox";
};

export const MailboxesSettingsPanel = () => {
  const navigate = useNavigate({ from: "/settings" });
  const { mailboxId } = settingsRouteApi.useSearch();
  const queryClient = useQueryClient();
  const session = authClient.useSession().data;
  const organizations = authClient.useListOrganizations().data ?? [];
  const [isAddMailboxOpen, setIsAddMailboxOpen] = useState(false);
  const [gmailOrganizationId, setGmailOrganizationId] = useState("");
  const [managedOrganizationId, setManagedOrganizationId] = useState("");
  const [managedDisplayName, setManagedDisplayName] = useState("");
  const [managedDivisionId, setManagedDivisionId] = useState<string | null>(null);
  const [managedLocalPart, setManagedLocalPart] = useState("");
  const [managedDomain, setManagedDomain] = useState<string>();
  const [isStartingGmail, setIsStartingGmail] = useState(false);
  const {
    data: mailboxesData,
    error: mailboxesError,
    isError: isMailboxesError,
    isPending: areMailboxesPending,
  } = useQuery(mailboxesQueryOptions());
  const { data: billing, isSuccess: isBillingSuccess } = useQuery(userBillingQueryOptions());
  const groups = mailboxesData?.groups ?? [];
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const selectedMailbox = mailboxId
    ? (mailboxes.find((mailbox) => mailbox.id === mailboxId) ?? null)
    : null;
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const selectedManagedOrganizationId = managedOrganizationId || organizations[0]?.id || "";
  const selectedManagedDetailOrganizationId =
    selectedMailbox?.provider === "managed" ? selectedMailbox.organizationId : "";
  const selectedManagedOrganization = organizations.find(
    (organization) => organization.id === selectedManagedOrganizationId,
  );
  const placementItems = organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));
  const { data: managedDomainsData, isLoading: areManagedDomainsLoading } = useQuery({
    ...organizationMailDomainsQueryOptions(selectedManagedOrganizationId),
    enabled: isAddMailboxOpen && selectedManagedOrganizationId.length > 0,
  });
  const { data: createManagedOrganization, isPending: isCreateManagedOrganizationPending } =
    useQuery({
      ...fullOrganizationQueryOptions(selectedManagedOrganizationId),
      enabled: isAddMailboxOpen && selectedManagedOrganizationId.length > 0,
    });
  const { data: managedDivisionsData } = useQuery({
    queryKey: ["organization", selectedManagedOrganizationId, "divisions"],
    queryFn: ({ signal }) =>
      rpc.organization.listDivisions({ organizationId: selectedManagedOrganizationId }, { signal }),
    enabled: isAddMailboxOpen && selectedManagedOrganizationId.length > 0,
  });
  const { data: detailManagedOrganization } = useQuery({
    ...fullOrganizationQueryOptions(selectedManagedDetailOrganizationId),
    enabled: selectedMailbox?.provider === "managed" && selectedMailbox.grantRole === "manager",
  });
  const { data: detailManagedDivisionsData } = useQuery({
    queryKey: ["organization", selectedManagedDetailOrganizationId, "divisions"],
    queryFn: ({ signal }) =>
      rpc.organization.listDivisions(
        { organizationId: selectedManagedDetailOrganizationId },
        { signal },
      ),
    enabled: selectedMailbox?.provider === "managed" && selectedMailbox.grantRole === "manager",
  });
  const {
    data: selectedManagedMailboxDetails,
    error: selectedManagedMailboxError,
    isPending: isSelectedManagedMailboxPending,
  } = useQuery({
    queryKey: ["mail", "managed-mailbox-details", selectedMailbox?.id],
    queryFn: ({ signal }) =>
      rpc.mail.getManagedMailboxDetails({ mailboxId: selectedMailbox?.id ?? "" }, { signal }),
    enabled: selectedMailbox?.provider === "managed" && selectedMailbox.grantRole === "manager",
  });
  const verifiedDomains = (managedDomainsData?.domains ?? []).filter(
    (domain) => domain.status === "verified" && domain.mode === "send_and_receive",
  );
  const selectedDomain = managedDomain ?? verifiedDomains[0]?.domain ?? "";
  const trimmedLocalPart = managedLocalPart.trim();
  const createManagedMember = createManagedOrganization?.members.find(
    (member) => member.userId === session?.user.id,
  );
  const canCreateManagedMailbox =
    !!createManagedMember &&
    (hasOrganizationRole(createManagedMember.role, "owner") ||
      hasOrganizationRole(createManagedMember.role, "admin"));

  const navigateToMailbox = (nextMailboxId: string) => {
    void navigate({
      search: (previous) => ({ ...previous, mailboxId: nextMailboxId, tab: "mailboxes" }),
      to: ".",
    });
  };
  const invalidateMailboxes = async () => {
    await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
  };
  const invalidateSelectedManagedMailbox = async () => {
    if (!selectedMailbox?.id) return;
    await queryClient.invalidateQueries({
      queryKey: ["mail", "managed-mailbox-details", selectedMailbox.id],
    });
  };
  const disconnectMailboxMutation = useMutation({
    ...orpc.mail.disconnectMailbox.mutationOptions(),
    mutationKey: ["mail", "disconnect-mailbox"],
    onSuccess: async () => {
      await invalidateMailboxes();
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, mailboxId: "" }),
        to: ".",
      });
    },
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
    onSuccess: async ({ mailboxId: createdMailboxId }) => {
      setManagedLocalPart("");
      setManagedDisplayName("");
      setManagedDivisionId(null);
      setIsAddMailboxOpen(false);
      await invalidateMailboxes();
      toast.success("Shared inbox created.");
      navigateToMailbox(createdMailboxId);
    },
  });
  const updateManagedMailboxMutation = useMutation({
    ...orpc.mail.updateManagedMailbox.mutationOptions(),
    mutationKey: ["mail", "update-managed-mailbox"],
    onSuccess: async () => {
      await Promise.all([invalidateMailboxes(), invalidateSelectedManagedMailbox()]);
    },
  });
  const setManagedMailboxGrantMutation = useMutation({
    ...orpc.mail.setManagedMailboxGrant.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const removeManagedMailboxGrantMutation = useMutation({
    ...orpc.mail.removeManagedMailboxGrant.mutationOptions(),
    mutationKey: ["mail", "remove-managed-mailbox-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const setManagedMailboxDivisionGrantMutation = useMutation({
    ...orpc.mail.setManagedMailboxDivisionGrant.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-division-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const removeManagedMailboxDivisionGrantMutation = useMutation({
    ...orpc.mail.removeManagedMailboxDivisionGrant.mutationOptions(),
    mutationKey: ["mail", "remove-managed-mailbox-division-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const setGmailAutoLabelingMutation = useMutation({
    ...orpc.mail.setGmailAutoLabeling.mutationOptions(),
    mutationKey: ["mail", "set-gmail-auto-labeling"],
    onSuccess: async () => {
      await Promise.all([invalidateMailboxes(), invalidateSelectedManagedMailbox()]);
    },
  });
  const setGmailUsefulDetailsMutation = useMutation({
    ...orpc.mail.setGmailUsefulDetails.mutationOptions(),
    mutationKey: ["mail", "set-gmail-useful-details"],
    onSuccess: async () => {
      await Promise.all([invalidateMailboxes(), invalidateSelectedManagedMailbox()]);
    },
  });

  const startGmailConnection = async (input?: { mailboxId?: string; organizationId?: string }) => {
    setIsStartingGmail(true);
    try {
      await openGoogleAccountLink({
        mailboxId: input?.mailboxId,
        organizationId:
          input?.organizationId === undefined
            ? gmailOrganizationId || organizations[0]?.id
            : input.organizationId,
        queryClient,
        returnTo: getSettingsReturnTo(input?.mailboxId),
      });
    } catch (error) {
      setIsStartingGmail(false);
      toast.error(error instanceof Error ? error.message : "Could not start Gmail connection.");
    }
  };
  const setDefaultMailbox = (nextMailboxId: string) => {
    const isDefault = nextMailboxId === defaultMailboxId;
    setDefaultMailboxMutation.mutate(
      { mailboxId: isDefault ? null : nextMailboxId },
      {
        onError: (error) =>
          toast.error(getMutationErrorMessage(error, "Could not update default mailbox.")),
      },
    );
  };

  if (!mailboxId) {
    return (
      <div className="space-y-8">
        <SettingsPageHeader
          action={
            <Button onClick={() => setIsAddMailboxOpen(true)} size="sm" type="button">
              <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
              Add mailbox
            </Button>
          }
          title="Mailboxes"
        >
          Connect personal mail and manage the shared inboxes you can access.
        </SettingsPageHeader>

        <SettingsSection title="Your mailboxes">
          {isMailboxesError ? (
            <SettingsCard className="p-6 text-sm text-destructive">
              {mailboxesError.message ?? "Could not load mailboxes."}
            </SettingsCard>
          ) : areMailboxesPending ? (
            <SettingsCard className="p-6 text-sm text-muted-foreground">
              Loading mailboxes…
            </SettingsCard>
          ) : groups.length > 0 ? (
            <div className="space-y-5">
              {groups.map((group) => (
                <div className="space-y-2" key={group.id}>
                  <p className="px-1 text-xs text-muted-foreground">{group.name}</p>
                  <SettingsRows>
                    {group.mailboxes.map((mailbox) => {
                      const description = [
                        mailbox.displayName?.trim() ? mailbox.emailAddress : null,
                        getProviderLabel(mailbox.provider),
                        mailbox.provider === "managed" && mailbox.grantRole
                          ? `${mailbox.grantRole} access`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" — ");
                      return (
                        <SettingsNavigationRow
                          description={description}
                          key={mailbox.id}
                          meta={
                            mailbox.connectionStatus === "needs_reconnect" ? (
                              <span className="text-destructive">Reconnect</span>
                            ) : mailbox.id === defaultMailboxId ? (
                              <span>Default</span>
                            ) : undefined
                          }
                          onClick={() => navigateToMailbox(mailbox.id)}
                          title={mailbox.displayName?.trim() || mailbox.emailAddress}
                        />
                      );
                    })}
                  </SettingsRows>
                </div>
              ))}
            </div>
          ) : (
            <SettingsCard className="p-6">
              <p className="text-sm text-foreground">No mailboxes yet</p>
              <p className="mt-1 text-sm/6 text-muted-foreground">
                Connect Gmail or create a shared inbox to start using Quieter.
              </p>
            </SettingsCard>
          )}
        </SettingsSection>

        <Dialog onOpenChange={setIsAddMailboxOpen} open={isAddMailboxOpen}>
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
                  <p className="text-sm text-foreground">Gmail</p>
                  <p className="mt-1 text-xs/5 text-muted-foreground">
                    Choose the team where this private mailbox should appear.
                  </p>
                </div>
                <div className="flex flex-col gap-2 @sm:flex-row">
                  <Select
                    items={placementItems}
                    onValueChange={(value) => setGmailOrganizationId(value ?? "")}
                    value={gmailOrganizationId || organizations[0]?.id}
                  >
                    <SelectTrigger aria-label="Gmail mailbox placement" className="flex-1">
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
                    onClick={() => void startGmailConnection()}
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
                  <p className="text-sm text-foreground">Shared inbox</p>
                  <p className="mt-1 text-xs/5 text-muted-foreground">
                    Team owners and admins can create an address on a verified domain with incoming
                    mail enabled.
                  </p>
                </div>
                <Select
                  items={placementItems}
                  onValueChange={(value) => {
                    setManagedOrganizationId(value ?? "");
                    setManagedDomain(undefined);
                    setManagedDivisionId(null);
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

                {isCreateManagedOrganizationPending ? (
                  <p className="rounded-md border border-border/70 bg-muted/15 px-3 py-2 text-xs/5 text-muted-foreground squircle">
                    Checking your team access…
                  </p>
                ) : canCreateManagedMailbox ? (
                  <>
                    <TextFieldInput
                      aria-label="Shared inbox display name"
                      onChange={(event) => setManagedDisplayName(event.currentTarget.value)}
                      placeholder="Display name, such as Support"
                      value={managedDisplayName}
                    />
                    <div className="keyboard-focus-within flex h-9 min-w-0 items-center rounded-md border border-input bg-background shadow-sm transition-colors squircle">
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
                          {areManagedDomainsLoading ? "loading…" : "no receiving domain"}
                        </span>
                      )}
                    </div>
                    <Select
                      items={[
                        { value: "none", label: "No primary division" },
                        ...(managedDivisionsData?.divisions ?? []).map((division) => ({
                          value: division.id,
                          label: division.name,
                        })),
                      ]}
                      onValueChange={(value) =>
                        setManagedDivisionId(value === "none" ? null : value)
                      }
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
                      <p className="text-xs/5 text-muted-foreground">
                        Add and verify a send-and-receive domain in{" "}
                        {selectedManagedOrganization?.name ?? "team"} settings before creating a
                        shared inbox.
                      </p>
                    )}
                    {createManagedMailboxMutation.isError && (
                      <p className="text-sm text-destructive">
                        {createManagedMailboxMutation.error.message ??
                          "Could not create shared inbox."}
                      </p>
                    )}
                    <Button
                      disabled={
                        !trimmedLocalPart ||
                        !selectedDomain ||
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
                            onError: (error) =>
                              toast.error(
                                getMutationErrorMessage(error, "Could not create shared inbox."),
                              ),
                          },
                        );
                      }}
                      type="button"
                    >
                      Create shared inbox
                    </Button>
                  </>
                ) : (
                  <p className="rounded-md border border-border/70 bg-muted/15 px-3 py-2 text-xs/5 text-muted-foreground squircle">
                    Only a team owner or admin can create a shared inbox for this team.
                  </p>
                )}
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton>Close</DialogCloseButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (areMailboxesPending) {
    return (
      <SettingsCard className="p-6 text-sm text-muted-foreground">Loading mailbox…</SettingsCard>
    );
  }

  if (!selectedMailbox) {
    return (
      <div className="space-y-8">
        <SettingsPageHeader title="Mailbox unavailable">
          This mailbox is no longer available to your account.
        </SettingsPageHeader>
        <SettingsCard className="p-6">
          <Button
            onClick={() =>
              void navigate({
                replace: true,
                search: (previous) => ({ ...previous, mailboxId: "" }),
                to: ".",
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            View mailboxes
          </Button>
        </SettingsCard>
      </div>
    );
  }

  const isDefault = selectedMailbox.id === defaultMailboxId;
  const hasAutomationAccess =
    isBillingSuccess && hasOrganizationAiAccess(billing, selectedMailbox.organizationId);
  const title = selectedMailbox.displayName?.trim() || selectedMailbox.emailAddress;
  const detailGroup = groups.find((group) =>
    group.mailboxes.some((mailbox) => mailbox.id === selectedMailbox.id),
  );

  return (
    <div className="space-y-8">
      <SettingsPageHeader eyebrow={getProviderLabel(selectedMailbox.provider)} title={title}>
        {selectedMailbox.displayName?.trim() && <span>{selectedMailbox.emailAddress} — </span>}
        {detailGroup?.name}
      </SettingsPageHeader>

      <SettingsSection
        description="Choose where this mailbox appears and which mailbox opens by default."
        title="General"
      >
        <SettingsRows>
          {selectedMailbox.provider !== "api" && (
            <SettingsRow
              action={
                <Button
                  disabled={setDefaultMailboxMutation.isPending}
                  onClick={() => setDefaultMailbox(selectedMailbox.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={isDefault ? PinIcon : PinOffIcon}
                  />
                  {isDefault ? "Default" : "Set as default"}
                </Button>
              }
              title="Default mailbox"
            >
              Open this mailbox when no other mailbox is selected.
            </SettingsRow>
          )}

          {selectedMailbox.provider === "gmail" && (
            <SettingsRow
              action={
                <Select
                  disabled={moveGmailMailboxMutation.isPending}
                  items={placementItems}
                  onValueChange={(value) => {
                    if (!value) return;
                    moveGmailMailboxMutation.mutate(
                      { mailboxId: selectedMailbox.id, organizationId: value },
                      {
                        onError: (error) =>
                          toast.error(getMutationErrorMessage(error, "Could not move mailbox.")),
                      },
                    );
                  }}
                  value={selectedMailbox.organizationId}
                >
                  <SelectTrigger
                    aria-label={`Team for ${selectedMailbox.emailAddress}`}
                    className="max-w-44"
                    size="sm"
                    variant="ghost"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
              title="Team"
            >
              Placement keeps mailbox switching organized; this mailbox remains private to you.
            </SettingsRow>
          )}

          {selectedMailbox.provider === "managed" && selectedMailbox.grantRole && (
            <SettingsRow
              action={<MailboxAccessPill role={selectedMailbox.grantRole} />}
              title="Your access"
            >
              {selectedMailbox.grantRole === "manager"
                ? "You can configure this shared inbox and its access."
                : selectedMailbox.grantRole === "responder"
                  ? "You can read and reply, but only managers can change mailbox settings."
                  : "You can read this inbox, but only managers can change mailbox settings."}
            </SettingsRow>
          )}

          {selectedMailbox.provider === "gmail" && (
            <SettingsRow
              action={
                selectedMailbox.connectionStatus === "needs_reconnect" ? (
                  <Button
                    disabled={isStartingGmail}
                    onClick={() =>
                      void startGmailConnection({
                        mailboxId: selectedMailbox.id,
                        organizationId: selectedMailbox.organizationId,
                      })
                    }
                    size="sm"
                    type="button"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className={cn("size-4", { "animate-spin": isStartingGmail })}
                      icon={isStartingGmail ? Loading03Icon : Mail01Icon}
                    />
                    Reconnect
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Connected</span>
                )
              }
              title="Connection"
            >
              {selectedMailbox.connectionStatus === "needs_reconnect"
                ? "Reconnect through Google to resume reading and sending mail."
                : "Quieter can read and send mail for this account."}
            </SettingsRow>
          )}
        </SettingsRows>
      </SettingsSection>

      {selectedMailbox.provider === "gmail" && (
        <>
          <SettingsSection
            description="Optional features that organize new Inbox mail and surface timely information."
            title="Intelligence"
          >
            <SettingsCard>
              <SettingsInsetRows>
                <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">Useful details</span>
                    <span className="mt-0.5 block text-xs/5 text-muted-foreground">
                      Show codes, deliveries, and deadlines above the inbox.
                      {!hasAutomationAccess && " Requires Pro access for this team."}
                    </span>
                  </span>
                  <Switch
                    aria-label={`Find time-sensitive updates in new mail for ${selectedMailbox.emailAddress}`}
                    checked={selectedMailbox.usefulDetailsEnabled}
                    className={switchClassName}
                    disabled={
                      !hasAutomationAccess ||
                      setGmailUsefulDetailsMutation.isPending ||
                      selectedMailbox.connectionStatus !== "connected"
                    }
                    onCheckedChange={(enabled) =>
                      setGmailUsefulDetailsMutation.mutate(
                        { enabled, mailboxId: selectedMailbox.id },
                        {
                          onError: (error) =>
                            toast.error(
                              getMutationErrorMessage(error, "Could not update useful details."),
                            ),
                        },
                      )
                    }
                  >
                    <SwitchThumb className="size-4 data-checked:translate-x-4" />
                  </Switch>
                </label>
                <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">Auto-label</span>
                    <span className="mt-0.5 block text-xs/5 text-muted-foreground">
                      Label new Inbox mail using each label&apos;s inclusion criteria.
                      {!hasAutomationAccess && " Requires Pro access for this team."}
                    </span>
                  </span>
                  <Switch
                    aria-label={`Automatically label new mail for ${selectedMailbox.emailAddress}`}
                    checked={selectedMailbox.autoLabelEnabled}
                    className={switchClassName}
                    disabled={
                      !hasAutomationAccess ||
                      setGmailAutoLabelingMutation.isPending ||
                      selectedMailbox.connectionStatus !== "connected"
                    }
                    onCheckedChange={(enabled) =>
                      setGmailAutoLabelingMutation.mutate(
                        { enabled, mailboxId: selectedMailbox.id },
                        {
                          onError: (error) =>
                            toast.error(
                              getMutationErrorMessage(error, "Could not update auto-labeling."),
                            ),
                        },
                      )
                    }
                  >
                    <SwitchThumb className="size-4 data-checked:translate-x-4" />
                  </Switch>
                </label>
              </SettingsInsetRows>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Remove mailbox">
            <SettingsCard>
              <SettingsRow
                action={
                  <Button
                    className="text-destructive hover:text-destructive"
                    disabled={disconnectMailboxMutation.isPending}
                    onClick={() =>
                      disconnectMailboxMutation.mutate(
                        { mailboxId: selectedMailbox.id },
                        {
                          onError: (error) =>
                            toast.error(
                              getMutationErrorMessage(error, "Could not remove mailbox."),
                            ),
                        },
                      )
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                    Remove
                  </Button>
                }
                title="Disconnect Gmail"
              >
                Remove this account and its saved credentials from Quieter.
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        </>
      )}

      {selectedMailbox.provider === "managed" && selectedMailbox.grantRole !== "manager" && (
        <SettingsSection title="Mailbox settings">
          <SettingsCard className="p-6">
            <p className="text-sm text-foreground">Manager access required</p>
            <p className="mt-1 max-w-2xl text-sm/6 text-muted-foreground">
              A mailbox manager can change shared-inbox features, routing, and member access. Your
              current role still lets you use every mail action included with that role.
            </p>
          </SettingsCard>
        </SettingsSection>
      )}

      {selectedMailbox.provider === "managed" && selectedMailbox.grantRole === "manager" && (
        <>
          {isSelectedManagedMailboxPending ? (
            <SettingsCard className="p-6 text-sm text-muted-foreground">
              Loading shared inbox settings…
            </SettingsCard>
          ) : selectedManagedMailboxError || !selectedManagedMailboxDetails ? (
            <SettingsCard className="p-6 text-sm text-destructive">
              {selectedManagedMailboxError?.message ?? "Could not load shared inbox settings."}
            </SettingsCard>
          ) : (
            <>
              <SettingsSection
                description="Set the name, primary division, and which messages appear in this inbox."
                title="Shared inbox"
              >
                <SettingsCard>
                  <SettingsInsetRows>
                    <div className={cn(settingsInsetRowClass, "gap-4")}>
                      <span className="min-w-0 flex-1 text-sm text-foreground">Display name</span>
                      <TextFieldInput
                        aria-label="Shared inbox display name"
                        className="max-w-64"
                        defaultValue={selectedManagedMailboxDetails.mailbox.displayName ?? ""}
                        key={`${selectedMailbox.id}-display-name`}
                        onBlur={(event) =>
                          updateManagedMailboxMutation.mutate(
                            {
                              displayName: event.currentTarget.value,
                              mailboxId: selectedMailbox.id,
                            },
                            {
                              onError: (error) =>
                                toast.error(
                                  getMutationErrorMessage(error, "Could not update mailbox."),
                                ),
                            },
                          )
                        }
                        placeholder="Display name"
                      />
                    </div>
                    <div className={cn(settingsInsetRowClass, "gap-4")}>
                      <span className="min-w-0 flex-1 text-sm text-foreground">
                        Primary division
                      </span>
                      <Select
                        items={[
                          { value: "none", label: "Unassigned" },
                          ...(detailManagedDivisionsData?.divisions ?? []).map((division) => ({
                            value: division.id,
                            label: division.name,
                          })),
                        ]}
                        onValueChange={(value) =>
                          updateManagedMailboxMutation.mutate(
                            {
                              divisionId: value === "none" ? null : value,
                              mailboxId: selectedMailbox.id,
                            },
                            {
                              onError: (error) =>
                                toast.error(
                                  getMutationErrorMessage(
                                    error,
                                    "Could not update mailbox division.",
                                  ),
                                ),
                            },
                          )
                        }
                        value={selectedManagedMailboxDetails.mailbox.divisionId ?? "none"}
                      >
                        <SelectTrigger aria-label="Primary division" size="sm" variant="ghost">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="none">Unassigned</SelectItem>
                          {(detailManagedDivisionsData?.divisions ?? []).map((division) => (
                            <SelectItem key={division.id} value={division.id}>
                              {division.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">Include API messages</span>
                        <span className="mt-0.5 block text-xs/5 text-muted-foreground">
                          Also show messages sent from this exact address through the team API.
                        </span>
                      </span>
                      <Switch
                        aria-label={`Show API messages sent from ${selectedMailbox.emailAddress}`}
                        checked={selectedManagedMailboxDetails.mailbox.includeApiSentMessages}
                        className={switchClassName}
                        disabled={updateManagedMailboxMutation.isPending}
                        onCheckedChange={(includeApiSentMessages) =>
                          updateManagedMailboxMutation.mutate(
                            { includeApiSentMessages, mailboxId: selectedMailbox.id },
                            {
                              onError: (error) =>
                                toast.error(
                                  getMutationErrorMessage(
                                    error,
                                    "Could not update API message setting.",
                                  ),
                                ),
                            },
                          )
                        }
                      >
                        <SwitchThumb className="size-4 data-checked:translate-x-4" />
                      </Switch>
                    </label>
                  </SettingsInsetRows>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                description="Organize new messages and surface time-sensitive information for everyone using this inbox."
                title="Intelligence"
              >
                <SettingsCard>
                  <SettingsInsetRows>
                    <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">Useful details</span>
                        <span className="mt-0.5 block text-xs/5 text-muted-foreground">
                          Show codes, deliveries, and deadlines above the inbox.
                          {!hasAutomationAccess && " Requires Pro access for this team."}
                        </span>
                      </span>
                      <Switch
                        aria-label={`Find time-sensitive updates in new mail for ${selectedMailbox.emailAddress}`}
                        checked={selectedManagedMailboxDetails.mailbox.usefulDetailsEnabled}
                        className={switchClassName}
                        disabled={!hasAutomationAccess || setGmailUsefulDetailsMutation.isPending}
                        onCheckedChange={(enabled) =>
                          setGmailUsefulDetailsMutation.mutate(
                            { enabled, mailboxId: selectedMailbox.id },
                            {
                              onError: (error) =>
                                toast.error(
                                  getMutationErrorMessage(
                                    error,
                                    "Could not update useful details.",
                                  ),
                                ),
                            },
                          )
                        }
                      >
                        <SwitchThumb className="size-4 data-checked:translate-x-4" />
                      </Switch>
                    </label>
                    <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">Auto-label</span>
                        <span className="mt-0.5 block text-xs/5 text-muted-foreground">
                          Label new Inbox mail using existing shared labels.
                          {!hasAutomationAccess && " Requires Pro access for this team."}
                        </span>
                      </span>
                      <Switch
                        aria-label={`Automatically label new mail for ${selectedMailbox.emailAddress}`}
                        checked={selectedManagedMailboxDetails.mailbox.autoLabelEnabled}
                        className={switchClassName}
                        disabled={!hasAutomationAccess || setGmailAutoLabelingMutation.isPending}
                        onCheckedChange={(enabled) =>
                          setGmailAutoLabelingMutation.mutate(
                            { enabled, mailboxId: selectedMailbox.id },
                            {
                              onError: (error) =>
                                toast.error(
                                  getMutationErrorMessage(error, "Could not update auto-labeling."),
                                ),
                            },
                          )
                        }
                      >
                        <SwitchThumb className="size-4 data-checked:translate-x-4" />
                      </Switch>
                    </label>
                  </SettingsInsetRows>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                description="Give an entire division the same level of access to this inbox."
                title="Division access"
              >
                <SettingsCard>
                  {(detailManagedDivisionsData?.divisions ?? []).length > 0 ? (
                    <SettingsInsetRows>
                      {(detailManagedDivisionsData?.divisions ?? []).map((division) => {
                        const grant = selectedManagedMailboxDetails.divisionGrants.find(
                          (item) => item.divisionId === division.id,
                        );
                        return (
                          <div className={cn(settingsInsetRowClass, "gap-3")} key={division.id}>
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                              {division.name}
                            </span>
                            <Select
                              items={mailboxGrantSelectItems}
                              onValueChange={(value) => {
                                if (!value || value === "none") {
                                  removeManagedMailboxDivisionGrantMutation.mutate(
                                    { divisionId: division.id, mailboxId: selectedMailbox.id },
                                    {
                                      onError: (error) =>
                                        toast.error(
                                          getMutationErrorMessage(
                                            error,
                                            "Could not remove access.",
                                          ),
                                        ),
                                    },
                                  );
                                  return;
                                }
                                setManagedMailboxDivisionGrantMutation.mutate(
                                  {
                                    divisionId: division.id,
                                    mailboxId: selectedMailbox.id,
                                    role: value as MailboxGrantRole,
                                  },
                                  {
                                    onError: (error) =>
                                      toast.error(
                                        getMutationErrorMessage(error, "Could not update access."),
                                      ),
                                  },
                                );
                              }}
                              value={grant?.role ?? "none"}
                            >
                              <SelectTrigger
                                aria-label={`${division.name} mailbox role`}
                                size="sm"
                                variant="ghost"
                              >
                                {grant ? (
                                  <MailboxAccessPill role={grant.role} />
                                ) : (
                                  <span className="text-muted-foreground">No access</span>
                                )}
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="none">No access</SelectItem>
                                {mailboxGrantRoleOptions.map((role) => (
                                  <SelectItem key={role.value} value={role.value}>
                                    <MailboxAccessPill role={role.value} />
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </SettingsInsetRows>
                  ) : (
                    <p className="p-6 text-sm text-muted-foreground">
                      This team has no divisions yet.
                    </p>
                  )}
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                description="Override division access for an individual team member."
                title="Direct member access"
              >
                <SettingsCard>
                  <SettingsInsetRows>
                    {(detailManagedOrganization?.members ?? []).map((member) => {
                      const grant = selectedManagedMailboxDetails.directGrants.find(
                        (item) => item.userId === member.userId,
                      );
                      return (
                        <div className={cn(settingsInsetRowClass, "gap-3")} key={member.id}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-foreground">
                              {member.user.name || member.user.email}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {member.user.email}
                            </span>
                          </span>
                          <Select
                            items={mailboxGrantSelectItems}
                            onValueChange={(value) => {
                              if (!value || value === "none") {
                                removeManagedMailboxGrantMutation.mutate(
                                  { mailboxId: selectedMailbox.id, userId: member.userId },
                                  {
                                    onError: (error) =>
                                      toast.error(
                                        getMutationErrorMessage(error, "Could not remove access."),
                                      ),
                                  },
                                );
                                return;
                              }
                              setManagedMailboxGrantMutation.mutate(
                                {
                                  mailboxId: selectedMailbox.id,
                                  role: value as MailboxGrantRole,
                                  userId: member.userId,
                                },
                                {
                                  onError: (error) =>
                                    toast.error(
                                      getMutationErrorMessage(error, "Could not update access."),
                                    ),
                                },
                              );
                            }}
                            value={grant?.role ?? "none"}
                          >
                            <SelectTrigger
                              aria-label={`${member.user.email} mailbox role`}
                              size="sm"
                              variant="ghost"
                            >
                              {grant ? (
                                <MailboxAccessPill role={grant.role} />
                              ) : (
                                <span className="text-muted-foreground">No access</span>
                              )}
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value="none">No access</SelectItem>
                              {mailboxGrantRoleOptions.map((role) => (
                                <SelectItem key={role.value} value={role.value}>
                                  <MailboxAccessPill role={role.value} />
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </SettingsInsetRows>
                </SettingsCard>
              </SettingsSection>
            </>
          )}
        </>
      )}

      {selectedMailbox.provider === "api" && (
        <SettingsSection title="Mailbox capabilities">
          <SettingsCard className="p-6">
            <p className="text-sm text-foreground">Send-only mailbox</p>
            <p className="mt-1 max-w-2xl text-sm/6 text-muted-foreground">
              This address sends through your team API. Its domain and access are managed in team
              settings.
            </p>
            <Button
              className="mt-4"
              onClick={() =>
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    mailboxId: "",
                    organizationId: selectedMailbox.organizationId,
                    organizationView: "api-keys",
                    tab: "organization",
                  }),
                  to: ".",
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Open team settings
              <HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />
            </Button>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  );
};
