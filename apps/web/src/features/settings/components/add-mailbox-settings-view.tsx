"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Loading03Icon,
  Mail01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
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
import { useState } from "react";

import {
  getSettingsReturnTo,
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
  SettingsPageHeader,
} from "#/features/settings/components/settings-layout";
import { authClient } from "#/lib/auth";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

type MailboxType = "gmail" | "shared";

const SetupProgress = ({
  currentStep,
  steps,
}: {
  currentStep: number;
  steps: readonly string[];
}) => (
  <ol aria-label="Mailbox setup progress" className="flex items-center gap-2">
    {steps.map((step, index) => {
      const stepNumber = index + 1;
      const isCurrent = stepNumber === currentStep;
      const isComplete = stepNumber < currentStep;

      return (
        <li
          aria-current={isCurrent ? "step" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2"
          key={step}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border text-micro tabular-nums",
              {
                "border-border bg-bg text-muted-fg": !isCurrent && !isComplete,
                "border-border-strong bg-control-hover text-fg": isComplete,
                "border-fg bg-fg text-bg": isCurrent,
              }
            )}
          >
            {stepNumber}
          </span>
          <span
            className={cn("truncate text-caption", {
              "text-fg": isCurrent,
              "text-muted-fg": !isCurrent,
            })}
          >
            {step}
          </span>
          {stepNumber < steps.length ? (
            <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
          ) : null}
        </li>
      );
    })}
  </ol>
);

const MailboxTypeChoice = ({
  onSelect,
}: {
  onSelect: (type: MailboxType) => void;
}) => (
  <SettingsCard className="bg-bg p-3">
    <div className="grid gap-3 @md:grid-cols-2">
      <button
        className="squircle group flex min-h-40 flex-col items-start rounded-lg border border-border bg-bg p-5 text-left transition-colors hover:border-border-strong hover:bg-control-hover focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
        onClick={() => {
          onSelect("gmail");
        }}
        type="button"
      >
        <span className="squircle flex size-10 items-center justify-center rounded-md border border-border bg-bg text-fg">
          <HugeiconsIcon aria-hidden className="size-5" icon={Mail01Icon} />
        </span>
        <span className="mt-5 text-body-sm text-fg">My Gmail account</span>
        <span className="mt-1 text-caption/5 text-muted-fg">
          Connect your own inbox. Only you can read and send mail from it.
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-5 text-caption text-fg">
          Choose Gmail
          <HugeiconsIcon
            aria-hidden
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            icon={ArrowRight01Icon}
          />
        </span>
      </button>

      <button
        className="squircle group flex min-h-40 flex-col items-start rounded-lg border border-border bg-bg p-5 text-left transition-colors hover:border-border-strong hover:bg-control-hover focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
        onClick={() => {
          onSelect("shared");
        }}
        type="button"
      >
        <span className="squircle flex size-10 items-center justify-center rounded-md border border-border bg-bg text-fg">
          <HugeiconsIcon aria-hidden className="size-5" icon={UserGroupIcon} />
        </span>
        <span className="mt-5 text-body-sm text-fg">Shared team inbox</span>
        <span className="mt-1 text-caption/5 text-muted-fg">
          Create an address such as support@ that teammates can work from.
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-5 text-caption text-fg">
          Choose shared inbox
          <HugeiconsIcon
            aria-hidden
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            icon={ArrowRight01Icon}
          />
        </span>
      </button>
    </div>
  </SettingsCard>
);

export const AddMailboxSettingsView = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const session = authClient.useSession().data;
  const organizations = authClient.useListOrganizations().data ?? [];
  const [mailboxType, setMailboxType] = useState<MailboxType>();
  const [isSharedDetailsVisible, setIsSharedDetailsVisible] = useState(false);
  const [gmailOrganizationId, setGmailOrganizationId] = useState("");
  const [managedOrganizationId, setManagedOrganizationId] = useState("");
  const [managedDisplayName, setManagedDisplayName] = useState("");
  const [managedDivisionId, setManagedDivisionId] = useState<string | null>(
    null
  );
  const [managedLocalPart, setManagedLocalPart] = useState("");
  const [managedDomain, setManagedDomain] = useState<string>();
  const [isStartingGmail, setIsStartingGmail] = useState(false);
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
      toast.success("Shared inbox created.");
      await navigateToMailbox(mailboxId);
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

  const selectMailboxType = (type: MailboxType) => {
    setMailboxType(type);
    setIsSharedDetailsVisible(false);
  };
  const resetMailboxType = () => {
    setMailboxType(undefined);
    setIsSharedDetailsVisible(false);
  };
  const sharedSteps = ["Mailbox type", "Team", "Address"] as const;
  const gmailSteps = ["Mailbox type", "Connect"] as const;
  let currentStep = 1;
  if (mailboxType !== undefined) {
    currentStep = isSharedDetailsVisible ? 3 : 2;
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader title="Add a mailbox">
        Choose what you are adding. We will only ask for the details that it
        needs.
      </SettingsPageHeader>

      <SetupProgress
        currentStep={currentStep}
        steps={isSharedFlow ? sharedSteps : gmailSteps}
      />

      {mailboxType === undefined ? (
        <MailboxTypeChoice onSelect={selectMailboxType} />
      ) : null}

      {mailboxType === "gmail" ? (
        <SettingsCard className="bg-bg p-5 @md:p-7">
          <Button
            className="mb-6 -ml-2"
            onClick={resetMailboxType}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon
              aria-hidden
              className="size-3.5"
              icon={ArrowLeft01Icon}
            />
            Change mailbox type
          </Button>
          <div className="max-w-xl">
            <h2 className="text-title-sm font-normal tracking-tight text-fg">
              Connect your Gmail account
            </h2>
            <p className="mt-2 text-body/6 text-muted-fg">
              Pick where the mailbox should appear. Google will open next so you
              can choose the account and approve access.
            </p>
            <div className="mt-7 space-y-2">
              <label className="text-caption text-fg" htmlFor="gmail-team">
                Team
              </label>
              <Select
                items={placementItems}
                onValueChange={(value) => {
                  setGmailOrganizationId(value ?? "");
                }}
                value={gmailOrganizationId || organizations[0]?.id}
              >
                <SelectTrigger
                  aria-label="Gmail mailbox team"
                  className="bg-bg"
                  id="gmail-team"
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
              <p className="text-caption/5 text-muted-fg">
                The mailbox stays private to you, even when it appears inside a
                team.
              </p>
            </div>
            <div className="mt-8 flex justify-end border-t border-border pt-5">
              <Button
                className="bg-bg hover:bg-control-hover"
                disabled={isStartingGmail || organizations.length === 0}
                onClick={() => {
                  runDetached(startGmailConnection);
                }}
                pending={isStartingGmail}
                pendingLabel="Opening Google"
                variant="outline"
              >
                <HugeiconsIcon
                  aria-hidden
                  className={cn("size-4", {
                    "animate-spin": isStartingGmail,
                  })}
                  icon={isStartingGmail ? Loading03Icon : Mail01Icon}
                />
                Continue with Google
              </Button>
            </div>
          </div>
        </SettingsCard>
      ) : null}

      {mailboxType === "shared" && !isSharedDetailsVisible ? (
        <SettingsCard className="bg-bg p-5 @md:p-7">
          <Button
            className="mb-6 -ml-2"
            onClick={resetMailboxType}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon
              aria-hidden
              className="size-3.5"
              icon={ArrowLeft01Icon}
            />
            Change mailbox type
          </Button>
          <div className="max-w-xl">
            <h2 className="text-title-sm font-normal tracking-tight text-fg">
              Choose the team
            </h2>
            <p className="mt-2 text-body/6 text-muted-fg">
              The team owns this inbox. Its owners and admins can manage access
              after you create it.
            </p>
            <div className="mt-7 space-y-2">
              <label className="text-caption text-fg" htmlFor="shared-team">
                Team
              </label>
              <Select
                items={placementItems}
                onValueChange={(value) => {
                  setManagedOrganizationId(value ?? "");
                  setManagedDomain(undefined);
                  setManagedDivisionId(null);
                }}
                value={selectedManagedOrganizationId || null}
              >
                <SelectTrigger
                  aria-label="Shared inbox team"
                  className="bg-bg"
                  id="shared-team"
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
              {isCreateManagedOrganizationPending ? (
                <p className="text-caption/5 text-muted-fg">
                  Checking your access…
                </p>
              ) : null}
              {!isCreateManagedOrganizationPending &&
              !canCreateManagedMailbox ? (
                <p className="text-caption/5 text-muted-fg">
                  Only a team owner or admin can create a shared inbox for this
                  team.
                </p>
              ) : null}
            </div>
            <div className="mt-8 flex justify-end border-t border-border pt-5">
              <Button
                className="bg-bg hover:bg-control-hover"
                disabled={
                  selectedManagedOrganizationId === "" ||
                  isCreateManagedOrganizationPending ||
                  !canCreateManagedMailbox
                }
                onClick={() => {
                  setIsSharedDetailsVisible(true);
                }}
                variant="outline"
              >
                Continue
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={ArrowRight01Icon}
                />
              </Button>
            </div>
          </div>
        </SettingsCard>
      ) : null}

      {mailboxType === "shared" && isSharedDetailsVisible ? (
        <SettingsCard className="bg-bg p-5 @md:p-7">
          <Button
            className="mb-6 -ml-2"
            onClick={() => {
              setIsSharedDetailsVisible(false);
            }}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon
              aria-hidden
              className="size-3.5"
              icon={ArrowLeft01Icon}
            />
            Back to team
          </Button>
          <div className="max-w-xl">
            <h2 className="text-title-sm font-normal tracking-tight text-fg">
              Create the address
            </h2>
            <p className="mt-2 text-body/6 text-muted-fg">
              Set the name people will see and the address they will write to.
            </p>
            <div className="mt-7 space-y-5">
              <div className="space-y-2">
                <label className="text-caption text-fg" htmlFor="display-name">
                  Display name
                </label>
                <TextFieldInput
                  className="bg-bg"
                  id="display-name"
                  onChange={(event) => {
                    setManagedDisplayName(event.currentTarget.value);
                  }}
                  placeholder="Support"
                  value={managedDisplayName}
                />
              </div>

              <div className="space-y-2">
                <label className="text-caption text-fg" htmlFor="local-part">
                  Email address
                </label>
                <div className="squircle flex h-9 min-w-0 items-center rounded-md border border-border bg-bg shadow-sm transition-colors">
                  <TextFieldInput
                    aria-label="Mailbox address"
                    chrome="ghost"
                    className="h-full min-w-0 flex-1 pr-1"
                    id="local-part"
                    onChange={(event) => {
                      setManagedLocalPart(
                        event.currentTarget.value.replaceAll(/[@\s]/gu, "")
                      );
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
                        setManagedDomain(value ?? undefined);
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
                  <p className="text-caption/5 text-muted-fg">
                    Add and verify a send-and-receive domain in{" "}
                    {selectedManagedOrganization?.name ?? "team"} settings
                    before creating a shared inbox.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-caption text-fg" htmlFor="division">
                  Primary division
                </label>
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
                    setManagedDivisionId(
                      value === "none" ? null : (value ?? null)
                    );
                  }}
                  value={managedDivisionId ?? "none"}
                >
                  <SelectTrigger className="bg-bg" id="division">
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
                <p className="text-caption/5 text-muted-fg">
                  Optional. A division helps organize access for larger teams.
                </p>
              </div>

              {createManagedMailboxMutation.isError ? (
                <p className="text-body text-destructive">
                  {createManagedMailboxMutation.error?.message ??
                    "Could not create shared inbox."}
                </p>
              ) : null}
            </div>
            <div className="mt-8 flex justify-end border-t border-border pt-5">
              <Button
                className="bg-bg hover:bg-control-hover"
                disabled={trimmedLocalPart === "" || selectedDomain === ""}
                onClick={() => {
                  createManagedMailboxMutation.mutate(
                    {
                      displayName: managedDisplayName,
                      divisionId: managedDivisionId,
                      emailAddress: `${trimmedLocalPart}@${selectedDomain}`,
                      organizationId: selectedManagedOrganizationId,
                    },
                    {
                      onError: showMutationError(
                        "Could not create shared inbox."
                      ),
                    }
                  );
                }}
                pending={createManagedMailboxMutation.isPending}
                pendingLabel="Creating inbox"
                variant="outline"
              >
                Create shared inbox
              </Button>
            </div>
          </div>
        </SettingsCard>
      ) : null}
    </div>
  );
};
