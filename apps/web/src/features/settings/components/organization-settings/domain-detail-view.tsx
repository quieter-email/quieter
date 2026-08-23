"use client";

import {
  Alert02Icon,
  CheckmarkCircle01Icon,
  Delete02Icon,
  Globe02Icon,
  Loading03Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
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
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";
import { settingsRouteApi } from "#/lib/route-apis";

import {
  SettingsBackButton,
  SettingsCard,
  SettingsInsetRows,
  SettingsLoadingState,
  SettingsPageHeader,
  SettingsSection,
  settingsSurfaceVariants,
} from "../settings-layout";
import type { FullOrganization } from "./domain";
import {
  getOrganizationDomainConnectQueryKey,
  getOrganizationMailDomainQueryKey,
  getOrganizationMailDomainsQueryKey,
  isOptionalDnsPurpose,
  isProviderLagCheck,
  organizationDomainConnectQueryOptions,
  organizationMailDomainQueryOptions,
  resolveMailDomainVerified,
} from "./mail-domains";
import { MutedActionButton } from "./settings-row";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatDate = (value: Date | string | null) => {
  if (value === null || value === undefined) {
    return "Not yet";
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const dnsTableColumns =
  "grid grid-cols-[3.25rem_minmax(7rem,0.85fr)_minmax(10rem,1.6fr)_4rem_3.25rem_5.25rem] items-center gap-3";

const copyDnsValue = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(
      <>
        Copied{" "}
        <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption font-normal break-all">
          {value}
        </code>
      </>,
      { id: `dns-copy:${value}` }
    );
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

const DnsCopyCell = ({ value }: { value: string }) => (
  <button
    aria-label={`Copy ${value}`}
    className={cn(
      "squircle max-w-full min-w-0 rounded-md px-1.5 py-0.5 text-left font-mono text-caption text-fg",
      "transition-[transform,background-color] duration-100 ease-out",
      "hover:bg-muted/70",
      "active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
    )}
    onClick={() => {
      void (async () => {
        try {
          await copyDnsValue(value);
        } catch {
          /* clipboard errors are surfaced in copyDnsValue */
        }
      })();
    }}
    title={`Copy ${value}`}
    type="button"
  >
    <span className="block truncate">{value}</span>
  </button>
);

const RecordState = ({
  message,
  ok,
}: {
  message: string;
  ok: boolean | null;
}) => {
  let className = "bg-muted/40 text-muted-fg";
  if (ok === true) {
    className = "bg-success/15 text-success";
  } else if (ok === false) {
    className = "bg-destructive/10 text-destructive";
  }

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-micro font-medium",
        className
      )}
    >
      {message}
    </span>
  );
};

type DomainStatusTone = "success" | "warning" | "error" | "neutral";

const getDomainVerificationStatus = ({
  domainStatus,
  isVerified,
  passingRecords,
  remainingRecords,
  sendingReady,
  totalRecords,
}: {
  domainStatus: string;
  isVerified: boolean;
  passingRecords: number;
  remainingRecords: number;
  sendingReady: boolean;
  totalRecords: number;
}) => {
  if (isVerified) {
    return {
      description: sendingReady
        ? "Every required check is passing."
        : "All DNS records are ready. Sending may still catch up for a short while.",
      label: "Verified",
      tone: "success" as const satisfies DomainStatusTone,
    };
  }
  if (remainingRecords > 0 && passingRecords > 0) {
    return {
      description: `${passingRecords} of ${totalRecords} DNS records are ready. Fix the remaining ${remainingRecords}.`,
      label: "Partially verified",
      tone: "warning" as const satisfies DomainStatusTone,
    };
  }
  if (domainStatus === "failed") {
    return {
      description: "Required DNS records are missing or incorrect.",
      label: "Check failed",
      tone: "error" as const satisfies DomainStatusTone,
    };
  }
  return {
    description: "Add the required DNS records, then run verification.",
    label: "Pending DNS",
    tone: "neutral" as const satisfies DomainStatusTone,
  };
};

const getManageReason = ({
  billingAccessUnknown,
  billingPending,
  canManageDomains,
  canUseOrganizationDomains,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageDomains: boolean;
  canUseOrganizationDomains: boolean;
}) => {
  if (billingPending) {
    return "Loading billing access…";
  }
  if (billingAccessUnknown) {
    return "Could not load billing access.";
  }
  if (!canUseOrganizationDomains) {
    return `Managing domains requires ${BILLING_FEATURES.organizationDomains.requirementLabel} billing.`;
  }
  if (!canManageDomains) {
    return "Only admins and owners can manage team domains.";
  }
  return null;
};

const getDomainConnectBannerClass = (domainConnect: string) => {
  if (domainConnect === "verified") {
    return "border-success/30 bg-success/10 text-success";
  }
  if (domainConnect === "needs_dns") {
    return "border-border bg-muted/30 text-fg";
  }
  return "border-destructive/25 bg-destructive/8 text-destructive";
};

const getDomainConnectMessage = (domainConnect: string) => {
  if (domainConnect === "verified") {
    return "One-click setup completed and DNS is verified.";
  }
  if (domainConnect === "needs_dns") {
    return "The provider flow returned. DNS still needs time or manual correction.";
  }
  if (domainConnect === "canceled") {
    return "One-click setup was canceled. You can retry safely.";
  }
  return "One-click setup could not be completed. Manual setup remains available.";
};

const getStatusSectionClass = (tone: DomainStatusTone) => {
  if (tone === "success") {
    return "border-success/30 bg-success/8";
  }
  if (tone === "error") {
    return "border-destructive/25 bg-destructive/6";
  }
  return "border-border bg-bg/58";
};

const getStatusIconClass = (tone: DomainStatusTone) => {
  if (tone === "success") {
    return "text-success";
  }
  if (tone === "error") {
    return "text-destructive";
  }
  return "text-muted-fg";
};

const getDnsRecordStatusMessage = (
  check: { ok: boolean } | undefined,
  required: boolean
) => {
  if (check?.ok === true) {
    return "Verified";
  }
  if (required) {
    return check === undefined ? "Pending" : "Fix";
  }
  return "Recommended";
};

const getDnsRecordStatusOk = (
  check: { ok: boolean } | undefined,
  required: boolean
): boolean | null => {
  if (check?.ok === true) {
    return true;
  }
  if (required) {
    return check?.ok ?? null;
  }
  return null;
};

const getStatusIcon = (tone: DomainStatusTone) => {
  if (tone === "success") {
    return CheckmarkCircle01Icon;
  }
  if (tone === "error") {
    return Alert02Icon;
  }
  return Globe02Icon;
};

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

const showRemoveDomainMutedAction = (
  manageReason: string | null,
  managedMailboxCount: number
) => manageReason !== null || managedMailboxCount > 0;

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

type DomainDetail = RouterOutputs["mailDomains"]["get"]["domain"];
type DomainCatchAll = RouterOutputs["mailDomains"]["get"]["catchAll"];
type DomainDnsCheck = NonNullable<
  DomainDetail["lastCheckResult"]
>["checks"][number];
type DomainDnsRecord = DomainDetail["requiredDnsRecords"][number];
type DomainConnectAvailability =
  RouterOutputs["mailDomains"]["getDomainConnectAvailability"];

const DomainHeader = ({
  domain,
  domainConnect,
  manageReason,
  onDismissDomainConnect,
  onVerify,
  verifyPending,
}: {
  domain: DomainDetail;
  domainConnect: string | undefined;
  manageReason: string | null;
  onDismissDomainConnect: () => void;
  onVerify: () => void;
  verifyPending: boolean;
}) => (
  <>
    <SettingsPageHeader
      action={
        manageReason === null ? (
          <Button
            disabled={verifyPending}
            onClick={onVerify}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon
              aria-hidden
              className={cn("size-4", verifyPending && "animate-spin")}
              icon={verifyPending ? Loading03Icon : Refresh01Icon}
            />
            Verify now
          </Button>
        ) : (
          <MutedActionButton
            icon={
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={Refresh01Icon}
              />
            }
            label="Verify"
            reason={manageReason}
          />
        )
      }
      title={domain.domain}
    >
      Registered {formatDate(domain.createdAt)}
    </SettingsPageHeader>

    {domainConnect === undefined ? null : (
      <div
        className={cn(
          "squircle @container flex flex-col gap-3 rounded-lg border px-4 py-3 text-body @sm:flex-row @sm:items-center @sm:justify-between",
          getDomainConnectBannerClass(domainConnect)
        )}
      >
        <span>{getDomainConnectMessage(domainConnect)}</span>
        <Button
          className="self-start @sm:self-auto"
          onClick={onDismissDomainConnect}
          size="sm"
          variant="ghost"
        >
          Dismiss
        </Button>
      </div>
    )}
  </>
);

const DomainStatusSummary = ({
  domain,
  passingRecords,
  sendingReady,
  status,
  totalRecords,
}: {
  domain: DomainDetail;
  passingRecords: number;
  sendingReady: boolean;
  status: ReturnType<typeof getDomainVerificationStatus>;
  totalRecords: number;
}) => (
  <section
    className={cn(
      "squircle relative overflow-hidden rounded-xl border p-5",
      getStatusSectionClass(status.tone)
    )}
  >
    <div className="@container relative grid gap-6 @lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(7rem,0.7fr))] @lg:items-center">
      <div>
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            aria-hidden
            className={cn("size-5", getStatusIconClass(status.tone))}
            icon={getStatusIcon(status.tone)}
          />
          <h2 className="text-body-lg font-medium text-fg">{status.label}</h2>
        </div>
        <p className="mt-2 max-w-lg text-body/6 text-muted-fg">
          {status.description}
        </p>
      </div>
      {[
        ["DNS records", `${passingRecords}/${totalRecords}`],
        ["Sending", sendingReady ? "Ready" : "Checking"],
        ["Incoming mail", domain.mode === "send_only" ? "Off" : "Enabled"],
      ].map(([label, value]) => (
        <div className="border-l border-border pl-4" key={label}>
          <p className="text-caption text-muted-fg">{label}</p>
          <p className="mt-1 text-body font-medium text-fg">{value}</p>
        </div>
      ))}
    </div>
  </section>
);

const DomainConnectCard = ({
  availability,
  isPending,
  manageReason,
  onStart,
  startPending,
}: {
  availability: DomainConnectAvailability | undefined;
  isPending: boolean;
  manageReason: string | null;
  onStart: () => void;
  startPending: boolean;
}) => {
  if (availability?.available !== true && !isPending) {
    return null;
  }

  return (
    <SettingsCard className="@container p-3.5 @md:px-4">
      <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
        <div className="min-w-0">
          <p className="text-body font-medium text-fg">
            {availability?.available === true
              ? `Connect with ${availability.provider.displayName}`
              : "Checking your DNS provider…"}
          </p>
          {availability?.available === true ? (
            <p className="mt-0.5 text-caption text-muted-fg">
              Authorize the exact records, then Quieter verifies DNS when you
              return.
            </p>
          ) : null}
        </div>
        {availability?.available === true &&
          (manageReason === null ? (
            <Button disabled={startPending} onClick={onStart} size="sm">
              <HugeiconsIcon
                aria-hidden
                className={cn("size-4", startPending && "animate-spin")}
                icon={startPending ? Loading03Icon : Globe02Icon}
              />
              Connect DNS
            </Button>
          ) : (
            <MutedActionButton
              icon={
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Globe02Icon}
                />
              }
              label="Connect DNS"
              reason={manageReason}
            />
          ))}
      </div>
    </SettingsCard>
  );
};

const DomainDnsRecordsTable = ({
  dnsChecks,
  records,
}: {
  dnsChecks: DomainDnsCheck[];
  records: DomainDnsRecord[];
}) => (
  <div className="squircle overflow-x-auto rounded-lg border border-border bg-bg/58">
    <table
      aria-label="DNS records"
      className="w-full min-w-160 border-collapse p-2"
    >
      <thead>
        <tr
          className={cn(
            dnsTableColumns,
            "rounded-md bg-muted/35 px-3 py-1.5 text-caption font-medium text-muted-fg"
          )}
        >
          <th scope="col">Type</th>
          <th scope="col">Host</th>
          <th scope="col">Value</th>
          <th scope="col">Priority</th>
          <th scope="col">TTL</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const check = dnsChecks.find(
            (candidate) =>
              candidate.recordName === record.name &&
              candidate.purpose === record.purpose
          );
          const priority =
            record.priority === null || record.priority === undefined
              ? null
              : String(record.priority);
          return (
            <tr
              className={cn(
                dnsTableColumns,
                "border-b border-border px-3 py-1.5 last:border-b-0"
              )}
              key={`${record.type}:${record.name}:${record.value}`}
            >
              <td className="min-w-0">
                <DnsCopyCell value={record.type} />
              </td>
              <td className="min-w-0">
                <DnsCopyCell value={record.name} />
              </td>
              <td className="min-w-0">
                <DnsCopyCell value={record.value} />
              </td>
              <td className="min-w-0">
                {priority === null ? (
                  <span className="px-1.5 font-mono text-caption text-muted-fg">
                    -
                  </span>
                ) : (
                  <DnsCopyCell value={priority} />
                )}
              </td>
              <td className="min-w-0 px-1.5 text-caption text-fg">Auto</td>
              <td>
                <RecordState
                  message={getDnsRecordStatusMessage(check, record.required)}
                  ok={getDnsRecordStatusOk(check, record.required)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const DomainDnsSetupSection = ({
  availability,
  dnsChecks,
  isDomainConnectPending,
  manageReason,
  onStartDomainConnect,
  startDomainConnectPending,
  domain,
}: {
  availability: DomainConnectAvailability | undefined;
  dnsChecks: DomainDnsCheck[];
  domain: DomainDetail;
  isDomainConnectPending: boolean;
  manageReason: string | null;
  onStartDomainConnect: () => void;
  startDomainConnectPending: boolean;
}) => (
  <SettingsSection
    description="Use one-click setup when your provider confirms support, or add every record manually."
    title="DNS setup"
  >
    <DomainConnectCard
      availability={availability}
      isPending={isDomainConnectPending}
      manageReason={manageReason}
      onStart={onStartDomainConnect}
      startPending={startDomainConnectPending}
    />
    <DomainDnsRecordsTable
      dnsChecks={dnsChecks}
      records={domain.requiredDnsRecords}
    />
  </SettingsSection>
);

const DomainMailModeSection = ({
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

const showCatchAllMutationError = (mutationError: unknown) => {
  toast.error(
    mutationError instanceof Error
      ? mutationError.message
      : "Could not update the whole-domain inbox."
  );
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
            { onError: showCatchAllMutationError }
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
            "squircle flex w-full items-center justify-between gap-3 rounded-md border border-border bg-bg-elevated px-3 py-2 text-left transition-colors",
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
                onError: showCatchAllMutationError,
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

const DomainCatchAllSection = ({
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

const DomainDeliverySection = ({
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

const DomainDangerSection = ({
  data,
  domain,
  manageReason,
  onRemove,
  removeMutation,
  removeOpen,
  setRemoveOpen,
}: {
  data: RouterOutputs["mailDomains"]["get"];
  domain: DomainDetail;
  manageReason: string | null;
  onRemove: () => void;
  removeMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["remove"],
    unknown,
    RouterInputs["mailDomains"]["remove"]
  >;
  removeOpen: boolean;
  setRemoveOpen: (open: boolean) => void;
}) => (
  <>
    <SettingsSection
      description="Removal releases the domain from this team. DNS records are not removed at your provider."
      title="Danger zone"
    >
      <SettingsCard className="p-5">
        <div className="@container flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
          <div>
            <p className="text-body font-medium text-fg">Remove domain</p>
            <p className="mt-1 text-caption/5 text-muted-fg">
              {data.managedMailboxCount > 0
                ? `Remove or migrate ${data.managedMailboxCount} shared ${data.managedMailboxCount === 1 ? "inbox" : "inboxes"} first.`
                : "This stops Quieter from sending or receiving mail for the domain."}
            </p>
          </div>
          {showRemoveDomainMutedAction(
            manageReason,
            data.managedMailboxCount
          ) ? (
            <MutedActionButton
              icon={
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Delete02Icon}
                />
              }
              label="Remove"
              reason={
                manageReason ??
                "Shared inboxes must be removed or migrated before removing this domain."
              }
            />
          ) : (
            <Button
              onClick={() => {
                setRemoveOpen(true);
              }}
              size="sm"
              variant="destructive"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={Delete02Icon}
              />
              Remove
            </Button>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>

    <Dialog onOpenChange={setRemoveOpen} open={removeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {domain.domain}?</DialogTitle>
          <DialogDescription>
            This action disconnects the domain from Quieter.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-body text-muted-fg">
          <p>Sending and incoming mail will stop for this domain.</p>
          <p>
            Remove the DNS records at your provider after this domain is
            disconnected.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={removeMutation.isPending}>
            Cancel
          </DialogCloseButton>
          <Button
            disabled={removeMutation.isPending}
            onClick={onRemove}
            size="sm"
            variant="destructive"
          >
            <HugeiconsIcon
              aria-hidden
              className={cn(
                "size-4",
                removeMutation.isPending && "animate-spin"
              )}
              icon={removeMutation.isPending ? Loading03Icon : Delete02Icon}
            />
            Remove domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);

export const DomainDetailView = ({
  billingAccessUnknown,
  billingPending,
  canManageDomains,
  canUseOrganizationDomains,
  domainId,
  onBack,
  organization,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageDomains: boolean;
  canUseOrganizationDomains: boolean;
  domainId: string;
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const navigate = useNavigate({ from: "/settings" });
  const { domainConnect } = settingsRouteApi.useSearch();
  const queryClient = useQueryClient();
  const [removeOpen, setRemoveOpen] = useState(false);
  const { data, error, isError, isPending } = useQuery(
    organizationMailDomainQueryOptions(organization.id, domainId)
  );
  const domain = data?.domain;
  const { data: domainConnectAvailability, isPending: isDomainConnectPending } =
    useQuery({
      ...organizationDomainConnectQueryOptions(organization.id, domainId),
      enabled: !!domain,
    });
  const invalidateDomain = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getOrganizationMailDomainQueryKey(organization.id, domainId),
      }),
      queryClient.invalidateQueries({
        queryKey: getOrganizationMailDomainsQueryKey(organization.id),
      }),
      queryClient.invalidateQueries({
        queryKey: getOrganizationDomainConnectQueryKey(
          organization.id,
          domainId
        ),
      }),
    ]);
  };
  const verifyMutation = useMutation({
    ...orpc.mailDomains.checkSetup.mutationOptions(),
    mutationKey: ["mail-domains", organization.id, domainId, "verify"],
    onSuccess: async (result) => {
      await invalidateDomain();
      if (result.status === "verified") {
        toast.success("Domain verified.");
      }
    },
  });
  const updateModeMutation = useMutation({
    ...orpc.mailDomains.updateMode.mutationOptions(),
    mutationKey: ["mail-domains", organization.id, domainId, "mode"],
    onSuccess: async () => {
      await invalidateDomain();
      toast.success("Mail mode updated.");
    },
  });
  const setCatchAllMutation = useMutation({
    ...orpc.mailDomains.setCatchAll.mutationOptions(),
    mutationKey: ["mail-domains", organization.id, domainId, "catch-all"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.mail.listManagedMailboxAdministration.queryOptions({
          input: { organizationId: organization.id },
        }).queryKey,
      });
      await invalidateDomain();
      toast.success("Whole-domain inbox updated.");
    },
  });
  const startDomainConnectMutation = useMutation({
    ...orpc.mailDomains.startDomainConnect.mutationOptions(),
    mutationKey: getOrganizationDomainConnectQueryKey(
      organization.id,
      domainId
    ),
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
  });
  const removeMutation = useMutation({
    ...orpc.mailDomains.remove.mutationOptions(),
    mutationKey: ["mail-domains", organization.id, domainId, "remove"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrganizationMailDomainsQueryKey(organization.id),
      });
      setRemoveOpen(false);
      toast.success("Domain removed.");
      onBack();
    },
  });

  if (isPending) {
    return (
      <>
        <SettingsBackButton onClick={onBack}>Domains</SettingsBackButton>
        <SettingsLoadingState className="min-h-48" label="Loading domain" />
      </>
    );
  }
  if (isError || !domain) {
    return (
      <>
        <SettingsBackButton onClick={onBack}>Domains</SettingsBackButton>
        <SettingsCard className="p-6 text-body text-destructive">
          {error?.message ?? "Domain not found."}
        </SettingsCard>
      </>
    );
  }

  const dnsChecks =
    domain.lastCheckResult?.checks.filter(
      (check) => (check.recordName ?? "") !== ""
    ) ?? [];
  const requiredDnsRecords = domain.requiredDnsRecords.filter(
    (record) => record.required && !isOptionalDnsPurpose(record.purpose)
  );
  const requiredDnsChecks = dnsChecks.filter((check) =>
    requiredDnsRecords.some(
      (record) =>
        record.name === check.recordName && record.purpose === check.purpose
    )
  );
  const passingRecords = requiredDnsChecks.filter((check) => check.ok).length;
  const totalRecords = requiredDnsRecords.length;
  const remainingRecords = Math.max(0, totalRecords - passingRecords);
  const dnsComplete = totalRecords > 0 && remainingRecords === 0;
  const isVerified = dnsComplete || resolveMailDomainVerified(domain);
  const sendingChecks =
    domain.lastCheckResult?.checks.filter((check) =>
      isProviderLagCheck(check.purpose)
    ) ?? [];
  const verifiedSendingChecks = sendingChecks.filter(
    (check) => check.ok
  ).length;
  const sendingReady =
    sendingChecks.length > 0 && verifiedSendingChecks === sendingChecks.length;
  const status = getDomainVerificationStatus({
    domainStatus: domain.status,
    isVerified,
    passingRecords,
    remainingRecords,
    sendingReady,
    totalRecords,
  });
  const manageReason = getManageReason({
    billingAccessUnknown,
    billingPending,
    canManageDomains,
    canUseOrganizationDomains,
  });

  const handleVerifyDomain = () => {
    verifyMutation.mutate(
      { domainId, organizationId: organization.id },
      {
        onError: (mutationError) => {
          toastError(mutationError, {
            boundary: "domain-settings",
            fallback: "Could not verify domain.",
          });
        },
      }
    );
  };

  const handleStartDomainConnect = () => {
    startDomainConnectMutation.mutate(
      { domainId, organizationId: organization.id },
      {
        onError: (mutationError) => {
          toastError(mutationError, {
            boundary: "domain-settings",
            fallback: "Could not start one-click setup.",
          });
        },
      }
    );
  };

  const handleDismissDomainConnect = async () => {
    try {
      await navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          domainConnect: undefined,
        }),
        to: ".",
      });
    } catch {
      /* navigation errors are surfaced elsewhere */
    }
  };

  const handleRemoveDomain = () => {
    removeMutation.mutate(
      { domainId, organizationId: organization.id },
      {
        onError: (mutationError) => {
          toastError(mutationError, {
            boundary: "domain-settings",
            fallback: "Could not remove domain.",
          });
        },
      }
    );
  };

  return (
    <div className="@container space-y-8">
      <SettingsBackButton onClick={onBack}>Domains</SettingsBackButton>
      <DomainHeader
        domain={domain}
        domainConnect={domainConnect}
        manageReason={manageReason}
        onDismissDomainConnect={() => {
          void handleDismissDomainConnect();
        }}
        onVerify={handleVerifyDomain}
        verifyPending={verifyMutation.isPending}
      />
      <DomainStatusSummary
        domain={domain}
        passingRecords={passingRecords}
        sendingReady={sendingReady}
        status={status}
        totalRecords={totalRecords}
      />
      <DomainDnsSetupSection
        availability={domainConnectAvailability}
        dnsChecks={dnsChecks}
        domain={domain}
        isDomainConnectPending={isDomainConnectPending}
        manageReason={manageReason}
        onStartDomainConnect={handleStartDomainConnect}
        startDomainConnectPending={startDomainConnectMutation.isPending}
      />
      <DomainMailModeSection
        blockedReason={data.modeChangeBlockedReason}
        domain={domain}
        domainId={domainId}
        manageReason={manageReason}
        organizationId={organization.id}
        updateModeMutation={updateModeMutation}
      />
      <DomainCatchAllSection
        catchAll={data.catchAll}
        domainId={domainId}
        domainName={domain.domain}
        incomingReady={domain.mode === "send_and_receive" && isVerified}
        manageReason={manageReason}
        organizationId={organization.id}
        setCatchAllMutation={setCatchAllMutation}
      />
      <DomainDeliverySection dnsChecks={dnsChecks} />
      <DomainDangerSection
        data={data}
        domain={domain}
        manageReason={manageReason}
        onRemove={handleRemoveDomain}
        removeMutation={removeMutation}
        removeOpen={removeOpen}
        setRemoveOpen={setRemoveOpen}
      />
    </div>
  );
};
