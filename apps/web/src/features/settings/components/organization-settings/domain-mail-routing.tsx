"use client";

import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
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
import { useQuery } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";

import {
  SettingsCard,
  SettingsInsetRows,
  SettingsLoadingState,
  SettingsSection,
  settingsSurfaceVariants,
} from "../settings-layout";
import { RecordState } from "./domain-status";
import type { DomainDetail, DomainDnsCheck } from "./domain-status";
import { MutedActionButton } from "./settings-row";

const getDeliveryRecordMessage = (
  ready: boolean,
  required: boolean,
  checkCount: number
) => {
  if (ready) {
    return "Ready";
  }
  if (required) {
    return checkCount > 0 ? "Needs attention" : "Pending";
  }
  return "Recommended";
};

const getDeliveryRecordOk = (
  ready: boolean,
  required: boolean,
  checkCount: number
): boolean | null => {
  if (ready) {
    return true;
  }
  if (required) {
    return checkCount > 0 ? false : null;
  }
  return null;
};

const getMailModeSwitchReason = (
  manageReason: string | null,
  blockedReason: string | null
) => {
  if (manageReason !== null) {
    return manageReason;
  }
  if ((blockedReason ?? "") !== "") {
    return blockedReason;
  }
  return null;
};

const showMutedMailModeSwitch = (
  manageReason: string | null,
  blockedReason: string | null
) => manageReason !== null || (blockedReason ?? "") !== "";

const getCatchAllActionReason = (
  incomingReady: boolean,
  manageReason: string | null
) => {
  if (manageReason !== null) {
    return manageReason;
  }
  if (!incomingReady) {
    return "Verify the domain with incoming mail enabled first.";
  }
  return null;
};

const MailModeOptionAction = ({
  blockedReason,
  domainId,
  manageReason,
  mode,
  organizationId,
  selected,
  updateModeMutation,
}: {
  blockedReason: string | null;
  domainId: string;
  manageReason: string | null;
  mode: "send_only" | "send_and_receive";
  organizationId: string;
  selected: boolean;
  updateModeMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["updateMode"],
    unknown,
    RouterInputs["mailDomains"]["updateMode"]
  >;
}) => {
  if (selected) {
    return <RecordState message="Current" ok />;
  }
  if (showMutedMailModeSwitch(manageReason, blockedReason)) {
    return (
      <MutedActionButton
        icon={
          <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
        }
        label="Switch"
        reason={getMailModeSwitchReason(manageReason, blockedReason) ?? ""}
      />
    );
  }
  return (
    <Button
      disabled={updateModeMutation.isPending}
      onClick={() => {
        updateModeMutation.mutate(
          {
            domainId,
            mode,
            organizationId,
          },
          {
            onError: (mutationError) => {
              toastError(mutationError, {
                boundary: "domain-settings",
                fallback: "Could not update mail mode.",
              });
            },
          }
        );
      }}
      size="sm"
      variant="outline"
    >
      Switch
    </Button>
  );
};

type DomainCatchAll = RouterOutputs["mailDomains"]["get"]["catchAll"];

export const DomainMailModeSection = ({
  blockedReason,
  domain,
  domainId,
  manageReason,
  organizationId,
  updateModeMutation,
}: {
  blockedReason: string | null;
  domain: DomainDetail;
  domainId: string;
  manageReason: string | null;
  organizationId: string;
  updateModeMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["updateMode"],
    unknown,
    RouterInputs["mailDomains"]["updateMode"]
  >;
}) => (
  <SettingsSection
    description="Choose whether this domain can host shared inboxes. Outbound authentication remains required in either mode."
    title="Mail mode"
  >
    <SettingsCard>
      <SettingsInsetRows>
        {[
          {
            description: "Transactional and API sending without incoming mail.",
            label: "Send only",
            value: "send_only" as const,
          },
          {
            description:
              "Sending plus shared inboxes and incoming message routing.",
            label: "Send and receive",
            value: "send_and_receive" as const,
          },
        ].map((option) => {
          const selected = domain.mode === option.value;
          const optionBlockedReason =
            option.value === "send_only" ? blockedReason : null;
          return (
            <div
              className={cn(
                "flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between",
                settingsSurfaceVariants({ variant: "padding" })
              )}
              key={option.value}
            >
              <div>
                <p className="text-body font-medium text-fg">{option.label}</p>
                <p className="mt-1 text-caption/5 text-muted-fg">
                  {optionBlockedReason ?? option.description}
                </p>
              </div>
              <MailModeOptionAction
                blockedReason={optionBlockedReason}
                domainId={domainId}
                manageReason={manageReason}
                mode={option.value}
                organizationId={organizationId}
                selected={selected}
                updateModeMutation={updateModeMutation}
              />
            </div>
          );
        })}
      </SettingsInsetRows>
    </SettingsCard>
  </SettingsSection>
);

const getCatchAllDescription = (catchAll: DomainCatchAll) => {
  if (catchAll === null) {
    return "No whole-domain inbox yet, so mail to unknown recipients at this domain is not delivered.";
  }
  return `Every unmatched recipient arrives in ${catchAll.emailAddress}. Exact shared inboxes keep priority, and replies send from that inbox's own address.`;
};

const DomainCatchAllAction = ({
  actionReason,
  catchAll,
  domainId,
  manageReason,
  onChooseInbox,
  organizationId,
  setCatchAllMutation,
}: {
  actionReason: string | null;
  catchAll: DomainCatchAll;
  domainId: string;
  manageReason: string | null;
  onChooseInbox: () => void;
  organizationId: string;
  setCatchAllMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["setCatchAll"],
    unknown,
    RouterInputs["mailDomains"]["setCatchAll"]
  >;
}) => {
  if (catchAll !== null) {
    if (manageReason !== null) {
      return (
        <MutedActionButton
          icon={
            <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
          }
          label="Remove"
          reason={manageReason}
        />
      );
    }
    return (
      <Button
        disabled={setCatchAllMutation.isPending}
        onClick={() => {
          setCatchAllMutation.mutate(
            { domainId, mailboxId: null, organizationId },
            {
              onError: (mutationError) => {
                toastError(mutationError, {
                  boundary: "domain-settings",
                  fallback: "Could not update the whole-domain inbox.",
                });
              },
            }
          );
        }}
        size="sm"
        variant="outline"
      >
        Remove
      </Button>
    );
  }

  const globeIcon = (
    <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
  );
  if (actionReason !== null) {
    return (
      <MutedActionButton
        icon={globeIcon}
        label="Choose inbox"
        reason={actionReason}
      />
    );
  }
  return (
    <Button onClick={onChooseInbox} size="sm" variant="outline">
      Choose inbox
    </Button>
  );
};

type CatchAllCandidate =
  RouterOutputs["mail"]["listManagedMailboxAdministration"]["mailboxes"][number];

const DomainCatchAllPickerBody = ({
  candidates,
  domainId,
  domainName,
  isAdminPending,
  onPicked,
  organizationId,
  setCatchAllMutation,
}: {
  candidates: CatchAllCandidate[];
  domainId: string;
  domainName: string;
  isAdminPending: boolean;
  onPicked: () => void;
  organizationId: string;
  setCatchAllMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["setCatchAll"],
    unknown,
    RouterInputs["mailDomains"]["setCatchAll"]
  >;
}) => {
  if (isAdminPending) {
    return <SettingsLoadingState label="Loading shared inboxes" />;
  }
  if (candidates.length === 0) {
    return (
      <p className="squircle rounded-md border border-border bg-muted/15 px-3 py-2 text-caption/5 text-muted-fg">
        Create a shared inbox on {domainName} first, then return here.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {candidates.map((mailbox) => (
        <button
          className={cn(
            "squircle flex w-full items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2 text-left transition-colors",
            "hover:bg-muted/25",
            "active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
            { "cursor-not-allowed opacity-50": setCatchAllMutation.isPending }
          )}
          disabled={setCatchAllMutation.isPending}
          key={mailbox.id}
          onClick={() => {
            setCatchAllMutation.mutate(
              { domainId, mailboxId: mailbox.id, organizationId },
              {
                onError: (mutationError) => {
                  toastError(mutationError, {
                    boundary: "domain-settings",
                    fallback: "Could not update the whole-domain inbox.",
                  });
                },
                onSuccess: onPicked,
              }
            );
          }}
          type="button"
        >
          <span className="min-w-0 truncate text-body text-fg">
            {mailbox.emailAddress}
          </span>
          {mailbox.catchAllDomain === null ? null : (
            <span className="shrink-0 text-caption text-muted-fg">current</span>
          )}
        </button>
      ))}
    </div>
  );
};

export const DomainCatchAllSection = ({
  catchAll,
  domainId,
  domainName,
  incomingReady,
  manageReason,
  organizationId,
  setCatchAllMutation,
}: {
  catchAll: DomainCatchAll;
  domainId: string;
  domainName: string;
  incomingReady: boolean;
  manageReason: string | null;
  organizationId: string;
  setCatchAllMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["setCatchAll"],
    unknown,
    RouterInputs["mailDomains"]["setCatchAll"]
  >;
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: adminData, isPending: isAdminPending } = useQuery({
    ...orpc.mail.listManagedMailboxAdministration.queryOptions({
      input: { organizationId },
    }),
    enabled: pickerOpen,
  });
  const candidates = (adminData?.mailboxes ?? []).filter((mailbox) =>
    mailbox.emailAddress.toLowerCase().endsWith(`@${domainName}`)
  );
  const actionReason = getCatchAllActionReason(incomingReady, manageReason);

  return (
    <SettingsSection
      description="Optionally deliver mail addressed to any address at this domain into one shared inbox."
      title="Whole-domain inbox"
    >
      <SettingsCard>
        <SettingsInsetRows>
          <div
            className={cn(
              "flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between",
              settingsSurfaceVariants({ variant: "padding" })
            )}
          >
            <div className="min-w-0">
              <p className="text-body font-medium text-fg">
                {catchAll === null ? `*@${domainName}` : catchAll.pattern}
              </p>
              <p className="mt-1 text-caption/5 text-muted-fg">
                {getCatchAllDescription(catchAll)}
              </p>
            </div>
            <DomainCatchAllAction
              actionReason={actionReason}
              catchAll={catchAll}
              domainId={domainId}
              manageReason={manageReason}
              onChooseInbox={() => {
                setPickerOpen(true);
              }}
              organizationId={organizationId}
              setCatchAllMutation={setCatchAllMutation}
            />
          </div>
        </SettingsInsetRows>
      </SettingsCard>

      <Dialog onOpenChange={setPickerOpen} open={pickerOpen}>
        <DialogContent className="w-[min(92vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Whole-domain inbox for {domainName}</DialogTitle>
            <DialogDescription>
              Pick the shared inbox that receives mail addressed to any other
              recipient at {domainName}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-caption/5 text-muted-fg">
              Exact shared inboxes always keep priority, and replies send from
              the chosen inbox&rsquo;s own address.
            </p>
            <DomainCatchAllPickerBody
              candidates={candidates}
              domainId={domainId}
              domainName={domainName}
              isAdminPending={isAdminPending}
              onPicked={() => {
                setPickerOpen(false);
              }}
              organizationId={organizationId}
              setCatchAllMutation={setCatchAllMutation}
            />
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
};

export const DomainDeliverySection = ({
  dnsChecks,
}: {
  dnsChecks: DomainDnsCheck[];
}) => (
  <SettingsSection
    description="Authentication records protect deliverability and make impersonation harder."
    title="Delivery and reputation"
  >
    <SettingsCard>
      <SettingsInsetRows>
        {[
          { label: "DKIM signing", purpose: "dkim", required: true },
          {
            label: "SPF authorization",
            purpose: "mail_from_spf",
            required: true,
          },
          { label: "DMARC policy", purpose: "dmarc", required: false },
        ].map((item) => {
          const checks = dnsChecks.filter(
            (check) => check.purpose === item.purpose
          );
          const ready = checks.length > 0 && checks.every((check) => check.ok);
          return (
            <div
              className={cn(
                "flex items-center justify-between gap-4",
                settingsSurfaceVariants({ variant: "padding" })
              )}
              key={item.purpose}
            >
              <div>
                <span className="text-body text-fg">{item.label}</span>
                {item.required ? null : (
                  <p className="mt-0.5 text-caption text-muted-fg">
                    Recommended. Any valid policy works; quarantine is
                    preferred.
                  </p>
                )}
              </div>
              <RecordState
                message={getDeliveryRecordMessage(
                  ready,
                  item.required,
                  checks.length
                )}
                ok={getDeliveryRecordOk(ready, item.required, checks.length)}
              />
            </div>
          );
        })}
      </SettingsInsetRows>
    </SettingsCard>
  </SettingsSection>
);
