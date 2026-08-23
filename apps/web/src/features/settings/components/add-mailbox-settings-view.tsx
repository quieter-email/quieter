"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@quieter/ui/progress";
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
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";

import { GuidedFlow } from "#/features/guided-flow/components/guided-flow";
import {
  getSettingsReturnTo,
  runDetached,
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
import { authClient } from "#/lib/auth";
import { toastError } from "#/lib/error-toast";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import { useAddMailboxSettingsStore } from "./add-mailbox-settings-store";

export const AddMailboxSettingsView = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const session = authClient.useSession().data;
  const organizations = authClient.useListOrganizations().data ?? [];
  const workflowStore = useAddMailboxSettingsStore();
  const {
    direction,
    gmailOrganizationId,
    isSharedDetailsVisible,
    isStartingGmail,
    mailboxType,
    managedDisplayName,
    managedDivisionId,
    managedDomain,
    managedLocalPart,
    managedOrganizationId,
    receiveWholeDomain,
  } = useSelector(workflowStore, (state) => state);
  const selectedManagedOrganizationId =
    managedOrganizationId || organizations[0]?.id || "";
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

  const navigateToMailbox = async (mailboxId: string) => {
    await navigate({
      search: (previous) => ({
        ...previous,
        mailboxId,
        mailboxView: "list",
        tab: "mailboxes",
      }),
      to: ".",
    });
  };
  const createManagedMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailbox.mutationOptions(),
    mutationKey: ["mail", "create-managed-mailbox"],
    onSuccess: async ({ mailboxId }) => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
      toast.success(
        receiveWholeDomain
          ? "Whole-domain shared inbox created."
          : "Shared inbox created."
      );
      await navigateToMailbox(mailboxId);
    },
  });

  const startGmailConnection = async () => {
    workflowStore.setState((state) => ({
      ...state,
      isStartingGmail: true,
    }));
    try {
      await openGoogleAccountLink({
        organizationId: gmailOrganizationId || organizations[0]?.id,
        queryClient,
        returnTo: getSettingsReturnTo(),
      });
    } catch (error) {
      workflowStore.setState((state) => ({
        ...state,
        isStartingGmail: false,
      }));
      toastError(error, {
        boundary: "gmail-connect",
        fallback: "Could not start Gmail connection.",
      });
    }
  };

  const resetMailboxType = () => {
    workflowStore.setState((state) => ({
      ...state,
      direction: "back",
      isSharedDetailsVisible: false,
      mailboxType: undefined,
    }));
  };
  const sharedSteps = ["Mailbox type", "Team", "Address"] as const;
  const gmailSteps = ["Mailbox type", "Connect"] as const;
  const steps = isSharedFlow ? sharedSteps : gmailSteps;
  let currentStep = 1;
  if (mailboxType !== undefined) {
    currentStep = isSharedDetailsVisible ? 3 : 2;
  }
  let activeStep = "mailbox-type";
  if (mailboxType === "gmail") {
    activeStep = "gmail";
  } else if (mailboxType === "shared") {
    activeStep = isSharedDetailsVisible ? "shared-address" : "shared-team";
  }
  const previousLabel = isSharedDetailsVisible ? "Team" : "Mailbox type";
  const goBack = isSharedDetailsVisible
    ? () => {
        workflowStore.setState((state) => ({
          ...state,
          direction: "back",
          isSharedDetailsVisible: false,
        }));
      }
    : resetMailboxType;
  const exitFlow = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        mailboxId: "",
        mailboxView: "list",
        tab: "mailboxes",
      }),
      to: ".",
    });
  };

  return (
    <GuidedFlow
      activeStep={activeStep}
      ariaLabel="Add a mailbox"
      direction={direction}
      headerCenter={
        <span className="text-body-sm font-medium text-fg">Add mailbox</span>
      }
      headerEnd={
        <div className="flex items-center gap-3">
          <span className="text-caption text-muted-fg">
            <span className="hidden sm:inline">Step </span>
            {currentStep} / {steps.length}
          </span>
          <Progress
            aria-label="Mailbox setup progress"
            className="hidden w-16 gap-0 sm:grid"
            max={steps.length}
            value={currentStep}
          >
            <ProgressTrack className="h-1 bg-control-hover">
              <ProgressIndicator className="bg-fg" />
            </ProgressTrack>
          </Progress>
        </div>
      }
      headerStart={
        <Button
          className="-ml-2 text-muted-fg hover:text-fg"
          onClick={exitFlow}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
          <span className="hidden sm:inline">Back to mailboxes</span>
          <span className="sm:hidden">Back</span>
        </Button>
      }
      previous={
        mailboxType === undefined ? null : (
          <Button
            className="text-muted-fg hover:text-fg"
            onClick={goBack}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
            {previousLabel}
          </Button>
        )
      }
    >
      {mailboxType === undefined ? (
        <div>
          <header className="mx-auto max-w-xl text-center">
            <h1 className="text-title-md font-medium tracking-tight text-fg">
              Add a mailbox
            </h1>
          </header>
          <div className="mt-9 grid gap-3 sm:grid-cols-2">
            <Button
              className="group h-auto min-h-32 w-full flex-col items-start justify-start rounded-xl bg-bg-surface p-6 text-left whitespace-normal hover:border-border-strong hover:bg-control-hover"
              onClick={() => {
                workflowStore.setState((state) => ({
                  ...state,
                  direction: "forward",
                  isSharedDetailsVisible: false,
                  mailboxType: "gmail",
                }));
              }}
              variant="outline"
            >
              <span className="text-body-sm font-medium text-fg">Gmail</span>
              <span className="mt-1 text-caption text-muted-fg">
                Private to you
              </span>
              <span className="mt-auto flex pt-6 text-fg">
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  icon={ArrowRight01Icon}
                />
              </span>
            </Button>

            <Button
              className="group h-auto min-h-32 w-full flex-col items-start justify-start rounded-xl bg-bg-surface p-6 text-left whitespace-normal hover:border-border-strong hover:bg-control-hover"
              onClick={() => {
                workflowStore.setState((state) => ({
                  ...state,
                  direction: "forward",
                  isSharedDetailsVisible: false,
                  mailboxType: "shared",
                }));
              }}
              variant="outline"
            >
              <span className="text-body-sm font-medium text-fg">
                Shared inbox
              </span>
              <span className="mt-1 text-caption text-muted-fg">
                Team address like support@
              </span>
              <span className="mt-auto flex pt-6 text-fg">
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  icon={ArrowRight01Icon}
                />
              </span>
            </Button>
          </div>
        </div>
      ) : null}

      {mailboxType === "gmail" ? (
        <div className="mx-auto max-w-md">
          <header>
            <p className="text-caption text-muted-fg">Connect</p>
            <h1 className="mt-2 text-title-md font-medium tracking-tight text-fg">
              Connect your Gmail account
            </h1>
            <p className="mt-3 text-body/6 text-muted-fg">
              Pick where the mailbox should appear. Google will open next so you
              can choose the account and approve access.
            </p>
          </header>
          <div className="mt-8">
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
                value={gmailOrganizationId || organizations[0]?.id}
              >
                <SelectTrigger aria-label="Gmail mailbox team" id="gmail-team">
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
              <FieldDescription>
                The mailbox stays private to you, even when it appears inside a
                team.
              </FieldDescription>
            </Field>
          </div>
          <div className="mt-9 flex justify-end border-t border-border/70 pt-5">
            <Button
              disabled={isStartingGmail || organizations.length === 0}
              onClick={() => {
                runDetached(startGmailConnection);
              }}
              pending={isStartingGmail}
              pendingLabel="Opening Google"
            >
              <HugeiconsIcon aria-hidden icon={Mail01Icon} />
              Continue with Google
            </Button>
          </div>
        </div>
      ) : null}

      {mailboxType === "shared" && !isSharedDetailsVisible ? (
        <div className="mx-auto max-w-md">
          <header>
            <p className="text-caption text-muted-fg">Team</p>
            <h1 className="mt-2 text-title-md font-medium tracking-tight text-fg">
              Choose the team
            </h1>
            <p className="mt-3 text-body/6 text-muted-fg">
              The team owns this inbox. Its owners and admins can manage access
              after you create it.
            </p>
          </header>
          <div className="mt-8">
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
                    receiveWholeDomain: false,
                  }));
                }}
                value={selectedManagedOrganizationId || null}
              >
                <SelectTrigger aria-label="Shared inbox team" id="shared-team">
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
                <FieldDescription>Checking your access…</FieldDescription>
              ) : null}
              {!isCreateManagedOrganizationPending &&
              !canCreateManagedMailbox ? (
                <FieldDescription>
                  Only a team owner or admin can create a shared inbox for this
                  team.
                </FieldDescription>
              ) : null}
            </Field>
          </div>
          <div className="mt-9 flex justify-end border-t border-border/70 pt-5">
            <Button
              disabled={
                selectedManagedOrganizationId === "" ||
                isCreateManagedOrganizationPending ||
                !canCreateManagedMailbox
              }
              onClick={() => {
                workflowStore.setState((state) => ({
                  ...state,
                  direction: "forward",
                  isSharedDetailsVisible: true,
                }));
              }}
            >
              Continue
              <HugeiconsIcon aria-hidden icon={ArrowRight01Icon} />
            </Button>
          </div>
        </div>
      ) : null}

      {mailboxType === "shared" && isSharedDetailsVisible ? (
        <div className="mx-auto max-w-md">
          <header>
            <p className="text-caption text-muted-fg">Address</p>
            <h1 className="mt-2 text-title-md font-medium tracking-tight text-fg">
              Create the address
            </h1>
            <p className="mt-3 text-body/6 text-muted-fg">
              Set the name people will see and the address they will write to.
            </p>
          </header>
          <div className="mt-8 space-y-5">
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
              <div className="squircle flex h-9 min-w-0 items-center rounded-md border border-border bg-input shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/45">
                <TextFieldInput
                  aria-label="Mailbox address"
                  chrome="ghost"
                  className="h-full min-w-0 flex-1 pr-1"
                  id="local-part"
                  onChange={(event) => {
                    workflowStore.setState((state) => ({
                      ...state,
                      managedLocalPart: event.currentTarget.value.replaceAll(
                        /[@\s]/gu,
                        ""
                      ),
                    }));
                  }}
                  placeholder="support"
                  value={managedLocalPart}
                />
                <span
                  aria-hidden
                  className="text-body text-muted-fg select-none"
                >
                  @
                </span>
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
                    {areManagedDomainsLoading
                      ? "loading…"
                      : "no receiving domain"}
                  </span>
                )}
              </div>
              {verifiedDomains.length === 0 && !areManagedDomainsLoading ? (
                <FieldDescription>
                  Add and verify a send-and-receive domain in{" "}
                  {selectedManagedOrganization?.name ?? "team"} settings before
                  creating a shared inbox.
                </FieldDescription>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="division">Primary division</FieldLabel>
              <Select
                items={[
                  { label: "No primary division", value: "none" },
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
                  <SelectItem value="none">No primary division</SelectItem>
                  {(managedDivisionsData?.divisions ?? []).map((division) => (
                    <SelectItem key={division.id} value={division.id}>
                      {division.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Optional. A division helps organize access for larger teams.
              </FieldDescription>
            </Field>

            {selectedDomain === "" ? null : (
              <label
                className="squircle flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-bg-surface px-3 py-2.5 transition-colors hover:bg-control-hover"
                htmlFor="managed-mailbox-whole-domain"
              >
                <Checkbox
                  checked={receiveWholeDomain}
                  className="mt-0.5"
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
                <span className="min-w-0">
                  <span className="block text-body text-fg">
                    Receive mail for any address at {selectedDomain}
                  </span>
                  <span className="mt-0.5 block text-caption/5 text-muted-fg">
                    Exact shared inboxes keep priority. Mail for every other
                    recipient lands here, while replies still send from this
                    inbox address.
                  </span>
                </span>
              </label>
            )}

            {createManagedMailboxMutation.isError ? (
              <p className="text-body text-destructive">
                {createManagedMailboxMutation.error?.message ??
                  "Could not create shared inbox."}
              </p>
            ) : null}
          </div>
          <div className="mt-9 flex justify-end border-t border-border/70 pt-5">
            <Button
              disabled={trimmedLocalPart === "" || selectedDomain === ""}
              onClick={() => {
                createManagedMailboxMutation.mutate(
                  {
                    displayName: managedDisplayName,
                    divisionId: managedDivisionId,
                    emailAddress: `${trimmedLocalPart}@${selectedDomain}`,
                    organizationId: selectedManagedOrganizationId,
                    receiveWholeDomain,
                  },
                  {
                    onError: (error) => {
                      toastError(error, {
                        boundary: "mailbox-settings",
                        fallback: "Could not create shared inbox.",
                      });
                    },
                  }
                );
              }}
              pending={createManagedMailboxMutation.isPending}
              pendingLabel="Creating inbox"
            >
              Create shared inbox
            </Button>
          </div>
        </div>
      ) : null}
    </GuidedFlow>
  );
};
