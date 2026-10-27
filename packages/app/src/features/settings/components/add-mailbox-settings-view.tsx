"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { useAddMailboxSettingsStore } from "@quieter/app/features/settings/components/add-mailbox-settings-store";
import {
  getSettingsReturnTo,
  runDetached,
} from "@quieter/app/features/settings/components/mailboxes-settings-shared";
import { organizationDivisionsQueryOptions } from "@quieter/app/features/settings/components/organization-settings/divisions-query";
import {
  fullOrganizationQueryOptions,
  hasOrganizationRole,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import {
  organizationMailDomainsQueryOptions,
  resolveMailDomainVerified,
} from "@quieter/app/features/settings/components/organization-settings/mail-domains";
import {
  SettingsCard,
  SettingsInsetRow,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { useSettingsTeam } from "@quieter/app/features/settings/components/use-settings-team";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { openGoogleAccountLink } from "@quieter/app/lib/google-account-link";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { InputAddon, InputGroup } from "@quieter/ui/input-group";
import { entranceMotionVariants } from "@quieter/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";

export const AddMailboxSettingsView = ({
  onNavigateToMailbox,
}: {
  onNavigateToMailbox: (mailboxId: string) => Promise<void>;
}) => {
  const queryClient = useQueryClient();
  const session = authClient.useSession().data;
  const { organizations, teamId } = useSettingsTeam();
  const workflowStore = useAddMailboxSettingsStore();
  const {
    gmailOrganizationId,
    isSharedDetailsVisible,
    isStartingGmail,
    mailboxType,
    managedAccessMode,
    managedOwnerUserId,
    managedDisplayName,
    managedDivisionId,
    managedDomain,
    managedLocalPart,
    managedOrganizationId,
    receiveWholeDomain,
  } = useSelector(workflowStore, (state) => state);
  const selectedManagedOrganizationId = managedOrganizationId || teamId || "";
  const selectedManagedOrganization = organizations.find(
    (organization) => organization.id === selectedManagedOrganizationId
  );
  const placementItems = organizations.map((organization) => ({
    label: organization.name,
    value: organization.id,
  }));
  const isSharedFlow = mailboxType === "shared";
  const { data: managedDomainsData, isLoading: areManagedDomainsLoading } =
    useQuery({
      ...organizationMailDomainsQueryOptions(selectedManagedOrganizationId),
      enabled: isSharedFlow && selectedManagedOrganizationId.length > 0,
    });
  const {
    data: createManagedOrganization,
    isPending: isCreateManagedOrganizationPending,
  } = useQuery({
    ...fullOrganizationQueryOptions(selectedManagedOrganizationId),
    enabled: isSharedFlow && selectedManagedOrganizationId.length > 0,
  });
  const { data: managedDivisionsData } = useQuery({
    ...organizationDivisionsQueryOptions(selectedManagedOrganizationId),
    enabled: isSharedFlow && selectedManagedOrganizationId.length > 0,
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

  const createManagedMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailbox.mutationOptions(),
    mutationKey: ["mail", "create-managed-mailbox"],
    onSuccess: async ({ mailboxId }, input) => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
      let successMessage = "Shared inbox created.";
      if (input.accessMode === "private") {
        successMessage = "Private mailbox created.";
      } else if (input.receiveWholeDomain === true) {
        successMessage = "Whole-domain shared inbox created.";
      }
      toast.success(successMessage);
      await onNavigateToMailbox(
        input.accessMode === "private" && input.ownerUserId !== session?.user.id
          ? ""
          : mailboxId
      );
    },
  });

  const startGmailConnection = async () => {
    workflowStore.setState((state) => ({
      ...state,
      isStartingGmail: true,
    }));
    try {
      await openGoogleAccountLink({
        organizationId: gmailOrganizationId || teamId,
        queryClient,
        returnTo: getSettingsReturnTo(),
      });
    } catch (error) {
      toastError(error, {
        boundary: "gmail-connect",
        fallback: "Could not start Gmail connection.",
      });
    } finally {
      workflowStore.setState((state) => ({
        ...state,
        isStartingGmail: false,
      }));
    }
  };

  const resetMailboxType = () => {
    workflowStore.setState((state) => ({
      ...state,
      isSharedDetailsVisible: false,
      mailboxType: undefined,
    }));
  };
  const goBack = isSharedDetailsVisible
    ? () => {
        workflowStore.setState((state) => ({
          ...state,
          isSharedDetailsVisible: false,
        }));
      }
    : resetMailboxType;

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader title="Add a mailbox">
        Connect Gmail and its calendars, or create a mailbox with your own
        domain.
      </SettingsPageHeader>

      <div
        className={entranceMotionVariants({ effect: "slide" })}
        key={
          mailboxType === "shared" && isSharedDetailsVisible
            ? "address"
            : (mailboxType ?? "choose")
        }
      >
        {mailboxType === undefined ? (
          <SettingsRows>
            <SettingsNavigationRow
              description="Connect your Gmail inbox and Google Calendar with one account."
              icon={<Icon aria-hidden icon={Mail01Icon} />}
              onClick={() => {
                workflowStore.setState((state) => ({
                  ...state,
                  isSharedDetailsVisible: false,
                  mailboxType: "gmail",
                }));
              }}
              title="Gmail"
            />
            <SettingsNavigationRow
              description="Create a custom mailbox with your own domain."
              icon={<Icon aria-hidden icon={Mail01Icon} />}
              onClick={() => {
                workflowStore.setState((state) => ({
                  ...state,
                  isSharedDetailsVisible: false,
                  mailboxType: "shared",
                }));
              }}
              title="Quieter managed mailbox"
            />
          </SettingsRows>
        ) : null}

        {mailboxType === "gmail" ? (
          <SettingsSection
            description="Google will ask you to allow mail and calendar access. Your mailbox and calendars stay private to you."
            title="Connect Gmail"
          >
            <SettingsCard>
              <div className={settingsSurfaceVariants({ variant: "body" })}>
                <Field>
                  <FieldLabel htmlFor="gmail-team">Team</FieldLabel>
                  <Select
                    items={placementItems}
                    onValueChange={(value) => {
                      workflowStore.setState((state) => ({
                        ...state,
                        gmailOrganizationId: value ?? "",
                      }));
                    }}
                    value={gmailOrganizationId || teamId}
                  >
                    <SelectTrigger
                      aria-label="Gmail mailbox team"
                      id="gmail-team"
                    >
                      <SelectValue placeholder="Select team" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {organizations.map((organization) => (
                        <SelectItem
                          key={organization.id}
                          value={organization.id}
                        >
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <SettingsInsetRow>
                <ActionFooter>
                  <Button onClick={goBack} variant="secondary">
                    <Icon aria-hidden icon={ArrowLeft01Icon} />
                    Back
                  </Button>
                  <Button
                    disabled={isStartingGmail || organizations.length === 0}
                    onClick={() => {
                      runDetached(startGmailConnection);
                    }}
                    pending={isStartingGmail}
                    pendingLabel="Opening Google"
                  >
                    <Icon aria-hidden icon={Mail01Icon} />
                    Connect Gmail
                  </Button>
                </ActionFooter>
              </SettingsInsetRow>
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {mailboxType === "shared" && !isSharedDetailsVisible ? (
          <SettingsSection title="Mailbox team">
            <SettingsCard>
              <div className={settingsSurfaceVariants({ variant: "body" })}>
                <Field>
                  <FieldLabel htmlFor="shared-team">Team</FieldLabel>
                  <Select
                    items={placementItems}
                    onValueChange={(value) => {
                      workflowStore.setState((state) => ({
                        ...state,
                        managedDivisionId: null,
                        managedDomain: undefined,
                        managedOrganizationId: value ?? "",
                        managedOwnerUserId: "",
                        receiveWholeDomain: false,
                      }));
                    }}
                    value={selectedManagedOrganizationId || null}
                  >
                    <SelectTrigger aria-label="Mailbox team" id="shared-team">
                      <SelectValue placeholder="Select team" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {organizations.map((organization) => (
                        <SelectItem
                          key={organization.id}
                          value={organization.id}
                        >
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <SettingsInsetRow>
                <ActionFooter>
                  <Button onClick={goBack} variant="secondary">
                    <Icon aria-hidden icon={ArrowLeft01Icon} />
                    Back
                  </Button>
                  <Button
                    disabled={
                      selectedManagedOrganizationId === "" ||
                      isCreateManagedOrganizationPending ||
                      !canCreateManagedMailbox
                    }
                    onClick={() => {
                      workflowStore.setState((state) => ({
                        ...state,
                        isSharedDetailsVisible: true,
                      }));
                    }}
                  >
                    Continue
                    <Icon aria-hidden icon={ArrowRight01Icon} />
                  </Button>
                </ActionFooter>
              </SettingsInsetRow>
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {mailboxType === "shared" && isSharedDetailsVisible ? (
          <SettingsSection title="Mailbox address">
            <SettingsCard>
              <div className={settingsSurfaceVariants({ variant: "body" })}>
                <Field>
                  <FieldLabel htmlFor="mailbox-access-mode">Access</FieldLabel>
                  <Select
                    items={[
                      { label: "Shared inbox", value: "shared" },
                      { label: "Private mailbox", value: "private" },
                    ]}
                    value={managedAccessMode}
                    onValueChange={(value) => {
                      if (value === "private" || value === "shared") {
                        workflowStore.setState((state) => ({
                          ...state,
                          managedAccessMode: value,
                          managedDivisionId: null,
                        }));
                      }
                    }}
                  >
                    <SelectTrigger id="mailbox-access-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shared">Shared inbox</SelectItem>
                      <SelectItem value="private">Private mailbox</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {managedAccessMode === "private"
                      ? "Only the selected owner can use this mailbox initially. You can grant individual access later."
                      : "Work together with people who have direct or division access."}
                  </FieldDescription>
                </Field>
                {managedAccessMode === "private" && (
                  <Field>
                    <FieldLabel htmlFor="mailbox-owner">Owner</FieldLabel>
                    <Select
                      items={(createManagedOrganization?.members ?? []).map(
                        (member) => ({
                          label: member.user.name || member.user.email,
                          value: member.userId,
                        })
                      )}
                      value={managedOwnerUserId || null}
                      onValueChange={(value) => {
                        workflowStore.setState((state) => ({
                          ...state,
                          managedOwnerUserId: value ?? "",
                        }));
                      }}
                    >
                      <SelectTrigger id="mailbox-owner">
                        <SelectValue placeholder="Choose a team member" />
                      </SelectTrigger>
                      <SelectContent>
                        {(createManagedOrganization?.members ?? []).map(
                          (member) => (
                            <SelectItem
                              key={member.userId}
                              value={member.userId}
                            >
                              {member.user.name || member.user.email}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                  <TextFieldInput
                    id="display-name"
                    onChange={(event) => {
                      workflowStore.setState((state) => ({
                        ...state,
                        managedDisplayName: event.currentTarget.value,
                      }));
                    }}
                    placeholder="Support"
                    value={managedDisplayName}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="local-part">Email address</FieldLabel>
                  <InputGroup>
                    <TextFieldInput
                      aria-label="Mailbox address"
                      chrome="attached"
                      id="local-part"
                      onChange={(event) => {
                        workflowStore.setState((state) => ({
                          ...state,
                          managedLocalPart:
                            event.currentTarget.value.replaceAll(/[@\s]/gu, ""),
                        }));
                      }}
                      placeholder="support"
                      value={managedLocalPart}
                    />
                    <InputAddon aria-hidden>@</InputAddon>
                    {verifiedDomains.length > 0 ? (
                      <Select
                        items={verifiedDomains.map((domain) => ({
                          label: domain.domain,
                          value: domain.domain,
                        }))}
                        onValueChange={(value) => {
                          workflowStore.setState((state) => ({
                            ...state,
                            managedDomain: value ?? undefined,
                          }));
                        }}
                        value={selectedDomain}
                      >
                        <SelectTrigger
                          aria-label="Mailbox domain"
                          size="sm"
                          variant="attached"
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
                        {areManagedDomainsLoading
                          ? "loading…"
                          : "no receiving domain"}
                      </span>
                    )}
                  </InputGroup>
                  {verifiedDomains.length === 0 && !areManagedDomainsLoading ? (
                    <FieldDescription>
                      Add and verify a send-and-receive domain in{" "}
                      {selectedManagedOrganization?.name ?? "team"} settings
                      before creating a mailbox.
                    </FieldDescription>
                  ) : null}
                </Field>

                {managedAccessMode === "shared" && (
                  <Field>
                    <FieldLabel htmlFor="division">Division</FieldLabel>
                    <Select
                      items={[
                        { label: "No division", value: "none" },
                        ...(managedDivisionsData?.divisions ?? []).map(
                          (division) => ({
                            label: division.name,
                            value: division.id,
                          })
                        ),
                      ]}
                      onValueChange={(value) => {
                        workflowStore.setState((state) => ({
                          ...state,
                          managedDivisionId:
                            value === "none" ? null : (value ?? null),
                        }));
                      }}
                      value={managedDivisionId ?? "none"}
                    >
                      <SelectTrigger id="division">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="none">No division</SelectItem>
                        {(managedDivisionsData?.divisions ?? []).map(
                          (division) => (
                            <SelectItem key={division.id} value={division.id}>
                              {division.name}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                {selectedDomain === "" ? null : (
                  <label
                    className="flex cursor-pointer items-center gap-2.5 py-1"
                    htmlFor="managed-mailbox-whole-domain"
                  >
                    <Checkbox
                      checked={receiveWholeDomain}
                      id="managed-mailbox-whole-domain"
                      onCheckedChange={(checked) => {
                        if (typeof checked === "boolean") {
                          workflowStore.setState((state) => ({
                            ...state,
                            receiveWholeDomain: checked,
                          }));
                        }
                      }}
                    >
                      <CheckboxIndicator />
                    </Checkbox>
                    <span className="text-body-sm text-fg">
                      Catch all mail for {selectedDomain}
                    </span>
                  </label>
                )}

                {createManagedMailboxMutation.isError ? (
                  <Text tone="destructive">
                    {createManagedMailboxMutation.error?.message ??
                      "Could not create mailbox."}
                  </Text>
                ) : null}
              </div>
              <SettingsInsetRow>
                <ActionFooter>
                  <Button onClick={goBack} variant="secondary">
                    <Icon aria-hidden icon={ArrowLeft01Icon} />
                    Back
                  </Button>
                  <Button
                    disabled={
                      trimmedLocalPart === "" ||
                      selectedDomain === "" ||
                      !canCreateManagedMailbox ||
                      (managedAccessMode === "private" &&
                        managedOwnerUserId === "")
                    }
                    onClick={() => {
                      createManagedMailboxMutation.mutate(
                        {
                          accessMode: managedAccessMode,
                          displayName: managedDisplayName,
                          divisionId:
                            managedAccessMode === "private"
                              ? null
                              : managedDivisionId,
                          emailAddress: `${trimmedLocalPart}@${selectedDomain}`,
                          organizationId: selectedManagedOrganizationId,
                          ownerUserId:
                            managedAccessMode === "private"
                              ? managedOwnerUserId
                              : null,
                          receiveWholeDomain,
                        },
                        {
                          onError: (error) => {
                            toastError(error, {
                              boundary: "mailbox-settings",
                              fallback: "Could not create mailbox.",
                            });
                          },
                        }
                      );
                    }}
                    pending={createManagedMailboxMutation.isPending}
                    pendingLabel="Creating inbox"
                  >
                    Create mailbox
                  </Button>
                </ActionFooter>
              </SettingsInsetRow>
            </SettingsCard>
          </SettingsSection>
        ) : null}
      </div>
    </div>
  );
};
