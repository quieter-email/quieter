"use client";

import {
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES, hasBillingPlanAccess } from "@quieter/billing/plans";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  SwitchThumb,
  TextFieldInput,
  cn,
  toast,
} from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MailboxSettingsRow } from "~/features/navigation/components/mailbox-switcher";
import { organizationMailDomainsQueryOptions } from "~/features/settings/components/organization-settings/mail-domains";
import { normalizeBillingPlan, userBillingQueryOptions } from "~/features/settings/domain/billing";
import { authClient } from "~/lib/auth";
import { openGoogleAccountLink } from "~/lib/google-account-link";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

const getSettingsReturnTo = () => "/settings?tab=mailboxes";
const personalPlacementValue = "personal";
const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const MailboxesSettingsPanel = () => {
  const queryClient = useQueryClient();
  const organizations = authClient.useListOrganizations().data ?? [];
  const [gmailOrganizationId, setGmailOrganizationId] = useState("");
  const [managedOrganizationId, setManagedOrganizationId] = useState("");
  const [managedLocalPart, setManagedLocalPart] = useState("");
  const [managedDomain, setManagedDomain] = useState<string | undefined>(undefined);
  const [isStartingGmail, setIsStartingGmail] = useState(false);
  const {
    data: mailboxesData,
    error: mailboxesError,
    isError: isMailboxesError,
  } = useQuery(mailboxesQueryOptions());
  const { data: billing, isSuccess: isBillingSuccess } = useQuery(userBillingQueryOptions());
  const currentPlan = normalizeBillingPlan(billing?.plan);
  const hasGmailAutomationAccess =
    isBillingSuccess &&
    (!!billing?.hasUnlimitedAccess ||
      hasBillingPlanAccess(currentPlan, BILLING_FEATURES.gmailAutomation.requiredPlan));
  const groups = mailboxesData?.groups ?? [];
  const gmailGroups = groups.map((group) => ({
    ...group,
    mailboxes: group.mailboxes.filter((mailbox) => mailbox.provider === "gmail"),
  }));
  const managedGroups = groups.map((group) => ({
    ...group,
    mailboxes: group.mailboxes.filter((mailbox) => mailbox.provider === "managed"),
  }));
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
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
  const { data: managedDomainsData, isLoading: areManagedDomainsLoading } = useQuery({
    ...organizationMailDomainsQueryOptions(managedOrganizationId),
    enabled: managedOrganizationId.length > 0,
  });
  const verifiedDomains = (managedDomainsData?.domains ?? []).filter(
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
  const setGmailAutoLabelingMutation = useMutation({
    ...orpc.mail.setGmailAutoLabeling.mutationOptions(),
    mutationKey: ["mail", "set-gmail-auto-labeling"],
    onSuccess: invalidateMailboxes,
  });
  const setGmailUsefulDetailsMutation = useMutation({
    ...orpc.mail.setGmailUsefulDetails.mutationOptions(),
    mutationKey: ["mail", "set-gmail-useful-details"],
    onSuccess: invalidateMailboxes,
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
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Connected Gmail</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect an existing personal or Google Workspace inbox. Organization placement does not
            share the mailbox with other members. Pro keeps your inbox current as mail arrives and
            can apply your existing Gmail labels or surface timely updates from new mail.
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
                return (
                  <div
                    className="overflow-hidden rounded-lg border border-border/70 bg-muted/15"
                    key={mailbox.id}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
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
                            className="max-w-40"
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
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-foreground">
                            Timely mail
                            {!hasGmailAutomationAccess && " · Pro"}
                          </span>
                          <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                            Codes, deliveries, deadlines, and other timely mail.
                          </span>
                        </span>
                        <Switch
                          aria-label={`Find time-sensitive updates in new mail for ${mailbox.emailAddress}`}
                          checked={mailbox.gmailUsefulDetailsEnabled}
                          className="h-5 w-9 shrink-0 p-0.5"
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
                                    getMutationErrorMessage(error, "Could not update timely mail."),
                                  );
                                },
                              },
                            );
                          }}
                        >
                          <SwitchThumb className="size-4 data-checked:translate-x-4" />
                        </Switch>
                      </label>

                      <label className="flex cursor-pointer items-center gap-3 border-t border-border/60 px-3 py-2.5 sm:border-t-0">
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-foreground">
                            Auto-label
                            {!hasGmailAutomationAccess && " · Pro"}
                          </span>
                          <span className="mt-0.5 block text-[11px]/4 text-muted-foreground">
                            Apply labels to new Inbox mail when they match the emails-to-include
                            rules you set on each label.
                          </span>
                        </span>
                        <Switch
                          aria-label={`Automatically label new mail for ${mailbox.emailAddress}`}
                          checked={mailbox.gmailAutoLabelEnabled}
                          className="h-5 w-9 shrink-0 p-0.5"
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

                    {mailbox.gmailUsefulDetailsEnabled && (
                      <p className="border-t border-border/60 px-3 py-2 text-[11px]/4 text-muted-foreground">
                        Updates appear above your inbox. To test, send a new verification email from
                        a different account; mail sent from this mailbox is ignored. New updates
                        should appear within seconds.
                      </p>
                    )}
                  </div>
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
                    : areManagedDomainsLoading
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
          !areManagedDomainsLoading &&
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
