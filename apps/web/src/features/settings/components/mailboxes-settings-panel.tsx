"use client";

import {
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  MailboxAccessPill,
  type MailboxGrantRole,
} from "~/features/mailbox/components/mailbox-access-pill";
import { fullOrganizationQueryOptions } from "~/features/settings/components/organization-settings/domain";
import { organizationMailDomainsQueryOptions } from "~/features/settings/components/organization-settings/mail-domains";
import {
  settingsInsetRowClass,
  settingsRowPaddingClass,
  SettingsInsetRows,
} from "~/features/settings/components/settings-layout";
import {
  hasOrganizationAiAccess,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { authClient } from "~/lib/auth";
import { openGoogleAccountLink } from "~/lib/google-account-link";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc, rpc } from "~/lib/orpc";

const getSettingsReturnTo = () => "/settings?tab=mailboxes";
const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const mailboxGrantRoleOptions = [
  { value: "reader", label: "Reader" },
  { value: "responder", label: "Responder" },
  { value: "manager", label: "Manager" },
] as const;
const mailboxGrantSelectItems = [{ value: "none", label: "No access" }, ...mailboxGrantRoleOptions];

export const MailboxesSettingsPanel = () => {
  const queryClient = useQueryClient();
  const organizations = authClient.useListOrganizations().data ?? [];
  const [gmailOrganizationId, setGmailOrganizationId] = useState("");
  const [managedOrganizationId, setManagedOrganizationId] = useState("");
  const [managedDisplayName, setManagedDisplayName] = useState("");
  const [managedDivisionId, setManagedDivisionId] = useState<string | null>(null);
  const [selectedManagedMailboxId, setSelectedManagedMailboxId] = useState<string | null>(null);
  const [managedLocalPart, setManagedLocalPart] = useState("");
  const [managedDomain, setManagedDomain] = useState<string | undefined>(undefined);
  const [isStartingGmail, setIsStartingGmail] = useState(false);
  const {
    data: mailboxesData,
    error: mailboxesError,
    isError: isMailboxesError,
  } = useQuery(mailboxesQueryOptions());
  const { data: billing, isSuccess: isBillingSuccess } = useQuery(userBillingQueryOptions());
  const groups = mailboxesData?.groups ?? [];
  const gmailGroups = groups.reduce<typeof groups>((nextGroups, group) => {
    const mailboxes = group.mailboxes.filter((mailbox) => mailbox.provider === "gmail");
    if (mailboxes.length > 0) {
      nextGroups.push({ ...group, mailboxes });
    }
    return nextGroups;
  }, []);
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const placementItems = organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));
  const organizationItems = organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
  }));
  const selectedManagedOrganizationId = managedOrganizationId || organizations[0]?.id || "";
  const { data: managedDomainsData, isLoading: areManagedDomainsLoading } = useQuery({
    ...organizationMailDomainsQueryOptions(selectedManagedOrganizationId),
    enabled: selectedManagedOrganizationId.length > 0,
  });
  const { data: selectedManagedOrganization } = useQuery({
    ...fullOrganizationQueryOptions(selectedManagedOrganizationId),
    enabled: selectedManagedOrganizationId.length > 0,
  });
  const { data: managedDivisionsData } = useQuery({
    queryKey: ["organization", selectedManagedOrganizationId, "divisions"],
    queryFn: ({ signal }) =>
      rpc.organization.listDivisions({ organizationId: selectedManagedOrganizationId }, { signal }),
    enabled: selectedManagedOrganizationId.length > 0,
  });
  const { data: managedAdminData } = useQuery({
    queryKey: ["mail", "managed-mailbox-admin", selectedManagedOrganizationId],
    queryFn: ({ signal }) =>
      rpc.mail.listManagedMailboxAdministration(
        { organizationId: selectedManagedOrganizationId },
        { signal },
      ),
    enabled: selectedManagedOrganizationId.length > 0,
  });
  const { data: selectedManagedMailboxDetails } = useQuery({
    queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
    queryFn: ({ signal }) =>
      rpc.mail.getManagedMailboxDetails({ mailboxId: selectedManagedMailboxId ?? "" }, { signal }),
    enabled: !!selectedManagedMailboxId,
  });
  const verifiedDomains = (managedDomainsData?.domains ?? []).filter(
    (domain) => domain.status === "verified",
  );
  const selectedDomain = managedDomain ?? verifiedDomains[0]?.domain ?? "";
  const trimmedLocalPart = managedLocalPart.trim();
  const invalidateMailboxes = async () => {
    await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
  };
  const invalidateSelectedManagedMailbox = async () => {
    if (!selectedManagedMailboxId) return;
    await queryClient.invalidateQueries({
      queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
    });
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
      setManagedDisplayName("");
      setManagedDivisionId(null);
      await invalidateMailboxes();
      await queryClient.invalidateQueries({
        queryKey: ["mail", "managed-mailbox-admin", selectedManagedOrganizationId],
      });
      toast.success("Managed mailbox created.");
    },
  });
  const updateManagedMailboxMutation = useMutation({
    ...orpc.mail.updateManagedMailbox.mutationOptions(),
    mutationKey: ["mail", "update-managed-mailbox"],
    onSuccess: async () => {
      await Promise.all([
        invalidateMailboxes(),
        queryClient.invalidateQueries({
          queryKey: ["mail", "managed-mailbox-admin", selectedManagedOrganizationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
        }),
      ]);
    },
  });
  const setManagedMailboxGrantMutation = useMutation({
    ...orpc.mail.setManagedMailboxGrant.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-grant"],
    onSuccess: async () => {
      await Promise.all([
        invalidateMailboxes(),
        queryClient.invalidateQueries({
          queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
        }),
      ]);
    },
  });
  const removeManagedMailboxGrantMutation = useMutation({
    ...orpc.mail.removeManagedMailboxGrant.mutationOptions(),
    mutationKey: ["mail", "remove-managed-mailbox-grant"],
    onSuccess: async () => {
      await Promise.all([
        invalidateMailboxes(),
        queryClient.invalidateQueries({
          queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
        }),
      ]);
    },
  });
  const setManagedMailboxDivisionGrantMutation = useMutation({
    ...orpc.mail.setManagedMailboxDivisionGrant.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-division-grant"],
    onSuccess: async () => {
      await Promise.all([
        invalidateMailboxes(),
        queryClient.invalidateQueries({
          queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
        }),
      ]);
    },
  });
  const removeManagedMailboxDivisionGrantMutation = useMutation({
    ...orpc.mail.removeManagedMailboxDivisionGrant.mutationOptions(),
    mutationKey: ["mail", "remove-managed-mailbox-division-grant"],
    onSuccess: async () => {
      await Promise.all([
        invalidateMailboxes(),
        queryClient.invalidateQueries({
          queryKey: ["mail", "managed-mailbox-details", selectedManagedMailboxId],
        }),
      ]);
    },
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
        returnTo: getSettingsReturnTo(),
      });
    } catch (error) {
      setIsStartingGmail(false);
      toast.error(error instanceof Error ? error.message : "Could not start Gmail connection.");
    }
  };
  const hasSelectedManagedAutomationAccess =
    !!selectedManagedMailboxDetails &&
    isBillingSuccess &&
    hasOrganizationAiAccess(billing, selectedManagedMailboxDetails.mailbox.organizationId);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground">Connected Gmail</h2>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            items={placementItems}
            onValueChange={(value) => setGmailOrganizationId(value ?? "")}
            value={gmailOrganizationId || organizations[0]?.id}
          >
            <SelectTrigger aria-label="Gmail mailbox placement" className="w-44">
              <SelectValue />
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

        {isMailboxesError && (
          <p className="text-sm text-destructive">
            {mailboxesError.message ?? "Could not load mailboxes."}
          </p>
        )}

        {gmailGroups.map((group) => (
          <div className="space-y-2" key={group.id}>
            <p className="text-xs text-muted-foreground">{group.name}</p>
            <div className="space-y-2">
              {group.mailboxes.map((mailbox) => {
                const isDefault = mailbox.id === defaultMailboxId;
                const hasGmailAutomationAccess =
                  isBillingSuccess && hasOrganizationAiAccess(billing, mailbox.organizationId);
                return (
                  <div
                    className="overflow-hidden rounded-lg border border-border/70 bg-muted/15 squircle"
                    key={mailbox.id}
                  >
                    <div className={cn(settingsInsetRowClass, "flex-wrap gap-2")}>
                      <div className="min-w-48 flex-1">
                        <p className="truncate text-sm text-foreground">{mailbox.emailAddress}</p>
                        {mailbox.connectionStatus === "needs_reconnect" && (
                          <p className="mt-0.5 text-xs text-destructive">
                            This account needs to reconnect through Google.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1">
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

                        <Select
                          disabled={moveGmailMailboxMutation.isPending}
                          items={placementItems}
                          onValueChange={(value) => {
                            if (!value) return;
                            moveGmailMailboxMutation.mutate(
                              {
                                mailboxId: mailbox.id,
                                organizationId: value,
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
                          value={mailbox.organizationId}
                        >
                          <SelectTrigger
                            aria-label={`Placement for ${mailbox.emailAddress}`}
                            className="max-w-40"
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
                          className="text-destructive hover:text-destructive"
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
                      </div>
                    </div>

                    <div className="grid border-t border-border/60 sm:grid-cols-2 sm:divide-x sm:divide-border/60">
                      <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-foreground">
                            Useful details
                            {!hasGmailAutomationAccess && (
                              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground squircle">
                                Pro
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                            Show codes, deliveries, and deadlines above the inbox.
                          </span>
                        </span>
                        <Switch
                          aria-label={`Find time-sensitive updates in new mail for ${mailbox.emailAddress}`}
                          checked={mailbox.usefulDetailsEnabled}
                          className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                          disabled={
                            !hasGmailAutomationAccess ||
                            setGmailUsefulDetailsMutation.isPending ||
                            mailbox.connectionStatus !== "connected"
                          }
                          onCheckedChange={(enabled) => {
                            setGmailUsefulDetailsMutation.mutate(
                              {
                                enabled,
                                mailboxId: mailbox.id,
                              },
                              {
                                onError: (error) => {
                                  toast.error(
                                    getMutationErrorMessage(
                                      error,
                                      "Could not update useful details.",
                                    ),
                                  );
                                },
                              },
                            );
                          }}
                        >
                          <SwitchThumb className="size-4 data-checked:translate-x-4" />
                        </Switch>
                      </label>

                      <label
                        className={cn(
                          settingsInsetRowClass,
                          "cursor-pointer gap-3 border-t border-border/60 sm:border-t-0",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-foreground">
                            Auto-label
                            {!hasGmailAutomationAccess && (
                              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground squircle">
                                Pro
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                            Label new Inbox mail using each label's include rules.
                          </span>
                        </span>
                        <Switch
                          aria-label={`Automatically label new mail for ${mailbox.emailAddress}`}
                          checked={mailbox.autoLabelEnabled}
                          className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                          disabled={
                            !hasGmailAutomationAccess ||
                            setGmailAutoLabelingMutation.isPending ||
                            mailbox.connectionStatus !== "connected"
                          }
                          onCheckedChange={(enabled) => {
                            setGmailAutoLabelingMutation.mutate(
                              {
                                enabled,
                                mailboxId: mailbox.id,
                              },
                              {
                                onError: (error) => {
                                  toast.error(
                                    getMutationErrorMessage(
                                      error,
                                      "Could not update auto-labeling.",
                                    ),
                                  );
                                },
                              },
                            );
                          }}
                        >
                          <SwitchThumb className="size-4 data-checked:translate-x-4" />
                        </Switch>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-sm font-medium text-foreground">Shared inbox</h2>
        {organizations.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Select
                items={organizationItems}
                onValueChange={(value) => {
                  setManagedOrganizationId(value ?? "");
                  setManagedDomain(undefined);
                  setManagedDivisionId(null);
                  setSelectedManagedMailboxId(null);
                }}
                value={selectedManagedOrganizationId || null}
              >
                <SelectTrigger aria-label="Managed mailbox team" className="w-44">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  alignItemWithTrigger={managedOrganizationId.length > 0}
                  className="min-w-(--anchor-width)"
                >
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <TextFieldInput
                aria-label="Managed mailbox display name"
                className="w-40"
                onChange={(event) => setManagedDisplayName(event.currentTarget.value)}
                placeholder="Support"
                value={managedDisplayName}
              />

              <div className="keyboard-focus-within flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-background shadow-sm transition-colors squircle">
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
                    {!selectedManagedOrganizationId
                      ? "domain"
                      : areManagedDomainsLoading
                        ? "loading…"
                        : "no verified domain"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Select
                items={[
                  { value: "none", label: "Unassigned" },
                  ...(managedDivisionsData?.divisions ?? []).map((division) => ({
                    value: division.id,
                    label: division.name,
                  })),
                ]}
                onValueChange={(value) => setManagedDivisionId(value === "none" ? null : value)}
                value={managedDivisionId ?? "none"}
              >
                <SelectTrigger aria-label="Primary division" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(managedDivisionsData?.divisions ?? []).map((division) => (
                    <SelectItem key={division.id} value={division.id}>
                      {division.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                disabled={
                  !trimmedLocalPart ||
                  !selectedDomain ||
                  !selectedManagedOrganizationId ||
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
                Create Managed Mailbox
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Create a team before creating a Managed mailbox.
          </p>
        )}
        {organizations.length > 0 &&
          selectedManagedOrganizationId.length > 0 &&
          !areManagedDomainsLoading &&
          verifiedDomains.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This team has no verified domain yet. Add and verify one in team settings to create a
              shared inbox.
            </p>
          )}
        {createManagedMailboxMutation.isError && (
          <p className="text-sm text-destructive">
            {createManagedMailboxMutation.error.message ?? "Could not create managed mailbox."}
          </p>
        )}

        {selectedManagedOrganizationId && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
            <div className="overflow-hidden rounded-lg border border-border/70 squircle">
              {(managedAdminData?.mailboxes ?? []).length > 0 ? (
                <SettingsInsetRows>
                  {(managedAdminData?.mailboxes ?? []).map((mailbox) => (
                    <div className={cn(settingsInsetRowClass, "gap-3")} key={mailbox.id}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {mailbox.displayName?.trim() || mailbox.emailAddress}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {mailbox.emailAddress} / {mailbox.divisionName ?? "Unassigned"} /{" "}
                          {mailbox.directGrantCount + mailbox.divisionGrantCount} grants
                        </p>
                      </div>
                      <Button
                        onClick={() => setSelectedManagedMailboxId(mailbox.id)}
                        size="sm"
                        type="button"
                        variant={selectedManagedMailboxId === mailbox.id ? "default" : "outline"}
                      >
                        Manage
                      </Button>
                    </div>
                  ))}
                </SettingsInsetRows>
              ) : (
                <p className={cn("text-sm text-muted-foreground", settingsRowPaddingClass)}>
                  No managed mailboxes in this team yet.
                </p>
              )}
            </div>

            {selectedManagedMailboxDetails ? (
              <div className="space-y-5 overflow-hidden rounded-lg border border-border/70 bg-muted/10 p-4 squircle">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {selectedManagedMailboxDetails.mailbox.displayName?.trim() ||
                      selectedManagedMailboxDetails.mailbox.emailAddress}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedManagedMailboxDetails.mailbox.emailAddress}
                  </p>
                </div>

                <div className="grid gap-2">
                  <TextFieldInput
                    aria-label="Managed mailbox display name"
                    defaultValue={selectedManagedMailboxDetails.mailbox.displayName ?? ""}
                    key={`${selectedManagedMailboxId}-display-name`}
                    onBlur={(event) => {
                      updateManagedMailboxMutation.mutate(
                        {
                          displayName: event.currentTarget.value,
                          mailboxId: selectedManagedMailboxDetails.mailbox.id,
                        },
                        {
                          onError: (error) =>
                            toast.error(
                              getMutationErrorMessage(error, "Could not update mailbox."),
                            ),
                        },
                      );
                    }}
                    placeholder="Display name"
                  />
                  <Select
                    items={[
                      { value: "none", label: "Unassigned" },
                      ...(managedDivisionsData?.divisions ?? []).map((division) => ({
                        value: division.id,
                        label: division.name,
                      })),
                    ]}
                    onValueChange={(value) => {
                      updateManagedMailboxMutation.mutate(
                        {
                          divisionId: value === "none" ? null : value,
                          mailboxId: selectedManagedMailboxDetails.mailbox.id,
                        },
                        {
                          onError: (error) =>
                            toast.error(
                              getMutationErrorMessage(error, "Could not update mailbox division."),
                            ),
                        },
                      );
                    }}
                    value={selectedManagedMailboxDetails.mailbox.divisionId ?? "none"}
                  >
                    <SelectTrigger aria-label="Primary division">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="none">Unassigned</SelectItem>
                      {(managedDivisionsData?.divisions ?? []).map((division) => (
                        <SelectItem key={division.id} value={division.id}>
                          {division.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-foreground">Features</h4>
                  <SettingsInsetRows className="mt-2">
                    <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-foreground">
                          Useful details
                          {!hasSelectedManagedAutomationAccess && (
                            <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground squircle">
                              Pro
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                          Show codes, deliveries, and deadlines above the inbox.
                        </span>
                      </span>
                      <Switch
                        aria-label={`Find time-sensitive updates in new mail for ${selectedManagedMailboxDetails.mailbox.emailAddress}`}
                        checked={selectedManagedMailboxDetails.mailbox.usefulDetailsEnabled}
                        className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                        disabled={
                          !hasSelectedManagedAutomationAccess ||
                          setGmailUsefulDetailsMutation.isPending
                        }
                        onCheckedChange={(enabled) => {
                          setGmailUsefulDetailsMutation.mutate(
                            {
                              enabled,
                              mailboxId: selectedManagedMailboxDetails.mailbox.id,
                            },
                            {
                              onError: (error) => {
                                toast.error(
                                  getMutationErrorMessage(
                                    error,
                                    "Could not update useful details.",
                                  ),
                                );
                              },
                            },
                          );
                        }}
                      >
                        <SwitchThumb className="size-4 data-checked:translate-x-4" />
                      </Switch>
                    </label>

                    <label className={cn(settingsInsetRowClass, "cursor-pointer gap-3")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-foreground">
                          Auto-label
                          {!hasSelectedManagedAutomationAccess && (
                            <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground squircle">
                              Pro
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                          Label new Inbox mail using existing shared labels.
                        </span>
                      </span>
                      <Switch
                        aria-label={`Automatically label new mail for ${selectedManagedMailboxDetails.mailbox.emailAddress}`}
                        checked={selectedManagedMailboxDetails.mailbox.autoLabelEnabled}
                        className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                        disabled={
                          !hasSelectedManagedAutomationAccess ||
                          setGmailAutoLabelingMutation.isPending
                        }
                        onCheckedChange={(enabled) => {
                          setGmailAutoLabelingMutation.mutate(
                            {
                              enabled,
                              mailboxId: selectedManagedMailboxDetails.mailbox.id,
                            },
                            {
                              onError: (error) => {
                                toast.error(
                                  getMutationErrorMessage(error, "Could not update auto-labeling."),
                                );
                              },
                            },
                          );
                        }}
                      >
                        <SwitchThumb className="size-4 data-checked:translate-x-4" />
                      </Switch>
                    </label>

                    <div className={cn(settingsInsetRowClass, "gap-3")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-foreground">
                          API messages
                        </span>
                        <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                          Also show matching API sends in this mailbox.
                        </span>
                      </span>
                      <Switch
                        aria-label={`Show API messages sent from ${selectedManagedMailboxDetails.mailbox.emailAddress} in this mailbox`}
                        checked={selectedManagedMailboxDetails.mailbox.includeApiSentMessages}
                        className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                        disabled={updateManagedMailboxMutation.isPending}
                        onCheckedChange={(includeApiSentMessages) => {
                          updateManagedMailboxMutation.mutate(
                            {
                              includeApiSentMessages,
                              mailboxId: selectedManagedMailboxDetails.mailbox.id,
                            },
                            {
                              onError: (error) => {
                                toast.error(
                                  getMutationErrorMessage(
                                    error,
                                    "Could not update API message setting.",
                                  ),
                                );
                              },
                            },
                          );
                        }}
                      >
                        <SwitchThumb className="size-4 data-checked:translate-x-4" />
                      </Switch>
                    </div>
                  </SettingsInsetRows>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-foreground">Division access</h4>
                  <SettingsInsetRows className="mt-2">
                    {(managedDivisionsData?.divisions ?? []).map((division) => {
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
                                  {
                                    divisionId: division.id,
                                    mailboxId: selectedManagedMailboxDetails.mailbox.id,
                                  },
                                  {
                                    onError: (error) =>
                                      toast.error(
                                        getMutationErrorMessage(error, "Could not remove access."),
                                      ),
                                  },
                                );
                                return;
                              }
                              setManagedMailboxDivisionGrantMutation.mutate(
                                {
                                  divisionId: division.id,
                                  mailboxId: selectedManagedMailboxDetails.mailbox.id,
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
                </div>

                <div>
                  <h4 className="text-xs font-medium text-foreground">Direct member access</h4>
                  <SettingsInsetRows className="mt-2 max-h-72 overflow-y-auto">
                    {(selectedManagedOrganization?.members ?? []).map((member) => {
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
                                  {
                                    mailboxId: selectedManagedMailboxDetails.mailbox.id,
                                    userId: member.userId,
                                  },
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
                                  mailboxId: selectedManagedMailboxDetails.mailbox.id,
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
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground squircle">
                Select a managed mailbox to configure access.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
