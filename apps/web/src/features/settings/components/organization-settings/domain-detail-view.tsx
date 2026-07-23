"use client";

import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  Globe02Icon,
  Loading03Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
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
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { orpc } from "~/lib/orpc";
import { settingsRouteApi } from "~/lib/route-apis";
import type { FullOrganization } from "./domain";
import {
  SettingsBackButton,
  SettingsCard,
  SettingsInsetRows,
  SettingsPageHeader,
  settingsRowPaddingClass,
  SettingsSection,
} from "../settings-layout";
import {
  getOrganizationMailDomainQueryKey,
  getOrganizationMailDomainsQueryKey,
  organizationDomainConnectQueryOptions,
  organizationMailDomainQueryOptions,
  type OrganizationMailDomainDnsRecord,
} from "./mail-domains";
import { MutedActionButton } from "./settings-row";

const dnsRecordCopy = {
  dkim: { description: "Authenticates messages sent from this domain.", label: "DKIM" },
  dmarc: { description: "Publishes the domain's authentication policy.", label: "DMARC" },
  inbound_mx: { description: "Routes incoming messages to Quieter.", label: "Incoming MX" },
  mail_from_mx: { description: "Routes outgoing delivery feedback.", label: "Bounce MX" },
  mail_from_spf: { description: "Authorizes mail sent through the bounce domain.", label: "SPF" },
  ownership: { description: "Proves this team controls the domain.", label: "Ownership" },
} satisfies Record<
  OrganizationMailDomainDnsRecord["purpose"],
  { description: string; label: string }
>;

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatDate = (value: Date | string | null) => {
  if (!value) return "Not yet";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const copyText = async (value: string, label: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

const CopyValue = ({ label, value }: { label: string; value: string }) => (
  <button
    className="group min-w-0 rounded-md text-left outline-none squircle focus-visible:ring-2 focus-visible:ring-ring/30"
    onClick={() => void copyText(value, label)}
    type="button"
  >
    <span className="flex items-center gap-1 text-[0.65rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
      {label}
      <HugeiconsIcon
        aria-hidden
        className="size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        icon={Copy01Icon}
      />
    </span>
    <span className="mt-1 block font-mono text-xs break-all text-foreground">{value}</span>
  </button>
);

const RecordState = ({ message, ok }: { message: string; ok: boolean | null }) => (
  <span
    className={cn(
      "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium",
      ok === true
        ? "border-success/30 bg-success/10 text-success"
        : ok === false
          ? "border-destructive/30 bg-destructive/8 text-destructive"
          : "border-border/70 bg-muted/25 text-muted-foreground",
    )}
  >
    {ok === true ? (
      <HugeiconsIcon aria-hidden className="size-3.5" icon={CheckmarkCircle01Icon} />
    ) : ok === false ? (
      <HugeiconsIcon aria-hidden className="size-3.5" icon={CancelCircleIcon} />
    ) : (
      <span className="size-1.5 rounded-full bg-current opacity-60" />
    )}
    {message}
  </span>
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
    organizationMailDomainQueryOptions(organization.id, domainId),
  );
  const domain = data?.domain;
  const { data: domainConnectAvailability, isPending: isDomainConnectPending } = useQuery({
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
        queryKey: ["mail-domains", organization.id, domainId, "domain-connect"],
      }),
    ]);
  };
  const verifyMutation = useMutation({
    ...orpc.mailDomains.checkSetup.mutationOptions(),
    mutationKey: ["mail-domains", organization.id, domainId, "verify"],
    onSuccess: async (result) => {
      await invalidateDomain();
      if (result.status === "verified") toast.success("Domain verified.");
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
  const startDomainConnectMutation = useMutation({
    ...orpc.mailDomains.startDomainConnect.mutationOptions(),
    mutationKey: ["mail-domains", organization.id, domainId, "domain-connect"],
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
        <SettingsCard className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading domain…
        </SettingsCard>
      </>
    );
  }
  if (isError || !domain) {
    return (
      <>
        <SettingsBackButton onClick={onBack}>Domains</SettingsBackButton>
        <SettingsCard className="p-6 text-sm text-destructive">
          {error?.message ?? "Domain not found."}
        </SettingsCard>
      </>
    );
  }

  const dnsChecks = domain.lastCheckResult?.checks.filter((check) => check.recordName) ?? [];
  const passingRecords = dnsChecks.filter((check) => check.ok).length;
  const failedRecords = dnsChecks.filter((check) => !check.ok).length;
  const totalRecords = domain.requiredDnsRecords.length;
  const status =
    domain.status === "verified"
      ? {
          description: "Every required check is passing.",
          label: "Verified",
          tone: "success" as const,
        }
      : passingRecords > 0
        ? {
            description: `${passingRecords} of ${totalRecords} DNS records are ready. Fix the remaining ${failedRecords || totalRecords - passingRecords}.`,
            label: "Partially verified",
            tone: "warning" as const,
          }
        : domain.status === "failed"
          ? {
              description: "Required DNS records are missing or incorrect.",
              label: "Check failed",
              tone: "error" as const,
            }
          : {
              description: "Add the required DNS records, then run verification.",
              label: "Pending DNS",
              tone: "neutral" as const,
            };
  const manageReason =
    (billingPending && "Loading billing access…") ||
    (billingAccessUnknown && "Could not load billing access.") ||
    (!canUseOrganizationDomains &&
      `Managing domains requires ${BILLING_FEATURES.organizationDomains.requirementLabel} billing.`) ||
    (!canManageDomains && "Only admins and owners can manage team domains.") ||
    null;
  const verifiedSendingChecks =
    domain.lastCheckResult?.checks.filter(
      (check) =>
        (check.purpose === "ses_identity" || check.purpose === "ses_mail_from") && check.ok,
    ).length ?? 0;

  return (
    <div className="@container space-y-8">
      <SettingsBackButton onClick={onBack}>Domains</SettingsBackButton>

      <SettingsPageHeader
        action={
          manageReason ? (
            <MutedActionButton
              icon={<HugeiconsIcon aria-hidden className="size-4" icon={Refresh01Icon} />}
              label="Verify"
              reason={manageReason}
            />
          ) : (
            <Button
              disabled={verifyMutation.isPending}
              onClick={() =>
                verifyMutation.mutate(
                  { domainId, organizationId: organization.id },
                  {
                    onError: (mutationError) =>
                      toast.error(
                        mutationError instanceof Error
                          ? mutationError.message
                          : "Could not verify domain.",
                      ),
                  },
                )
              }
              size="sm"
              variant="outline"
            >
              <HugeiconsIcon
                aria-hidden
                className={cn("size-4", verifyMutation.isPending && "animate-spin")}
                icon={verifyMutation.isPending ? Loading03Icon : Refresh01Icon}
              />
              Verify now
            </Button>
          )
        }
        eyebrow={organization.name}
        title={domain.domain}
      >
        Registered {formatDate(domain.createdAt)}
      </SettingsPageHeader>

      {domainConnect && (
        <div
          className={cn(
            "@container flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm squircle @sm:flex-row @sm:items-center @sm:justify-between",
            domainConnect === "verified"
              ? "border-success/30 bg-success/10 text-success"
              : domainConnect === "needs_dns"
                ? "border-border bg-muted/30 text-foreground"
                : "border-destructive/25 bg-destructive/8 text-destructive",
          )}
        >
          <span>
            {domainConnect === "verified"
              ? "One-click setup completed and DNS is verified."
              : domainConnect === "needs_dns"
                ? "The provider flow returned. DNS still needs time or manual correction."
                : domainConnect === "canceled"
                  ? "One-click setup was canceled. You can retry safely."
                  : "One-click setup could not be completed. Manual setup remains available."}
          </span>
          <Button
            className="self-start @sm:self-auto"
            onClick={() =>
              void navigate({
                replace: true,
                search: (previous) => ({ ...previous, domainConnect: undefined }),
                to: ".",
              })
            }
            size="sm"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      )}

      <section
        className={cn(
          "relative overflow-hidden rounded-xl border p-5 squircle",
          status.tone === "success"
            ? "border-success/30 bg-success/8"
            : status.tone === "error"
              ? "border-destructive/25 bg-destructive/6"
              : "border-border/70 bg-background/58",
        )}
      >
        <div className="@container relative grid gap-6 @lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(7rem,0.7fr))] @lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                aria-hidden
                className={cn(
                  "size-5",
                  status.tone === "success"
                    ? "text-success"
                    : status.tone === "error"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
                icon={
                  status.tone === "success"
                    ? CheckmarkCircle01Icon
                    : status.tone === "error"
                      ? Alert02Icon
                      : Globe02Icon
                }
              />
              <h2 className="text-base font-medium text-foreground">{status.label}</h2>
            </div>
            <p className="mt-2 max-w-lg text-sm/6 text-muted-foreground">{status.description}</p>
          </div>
          {[
            ["DNS records", `${passingRecords}/${totalRecords}`],
            ["Sending", verifiedSendingChecks === 2 ? "Ready" : "Checking"],
            ["Incoming mail", domain.mode === "send_only" ? "Off" : "Enabled"],
          ].map(([label, value]) => (
            <div className="border-l border-border/70 pl-4" key={label}>
              <p className="text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase">
                {label}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <SettingsSection
        description="Use one-click setup when your provider confirms support, or add every record manually."
        title="DNS setup"
      >
        <SettingsCard className="@container p-4 @md:p-5">
          <div className="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {domainConnectAvailability?.available
                  ? `Connect with ${domainConnectAvailability.provider.displayName}`
                  : isDomainConnectPending
                    ? "Checking your DNS provider…"
                    : domainConnectAvailability?.providerName
                      ? `${domainConnectAvailability.providerName} needs manual setup`
                      : "Manual setup"}
              </p>
              <p className="mt-1 max-w-2xl text-xs/5 text-muted-foreground">
                {domainConnectAvailability?.available
                  ? "Review and authorize the exact records at your DNS provider. Quieter verifies DNS again when you return."
                  : "One-click setup is only shown after the provider confirms support for this exact Quieter template."}
              </p>
            </div>
            {domainConnectAvailability?.available &&
              (manageReason ? (
                <MutedActionButton
                  icon={<HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />}
                  label="Connect DNS"
                  reason={manageReason}
                />
              ) : (
                <Button
                  disabled={startDomainConnectMutation.isPending}
                  onClick={() =>
                    startDomainConnectMutation.mutate(
                      { domainId, organizationId: organization.id },
                      {
                        onError: (mutationError) =>
                          toast.error(
                            mutationError instanceof Error
                              ? mutationError.message
                              : "Could not start one-click setup.",
                          ),
                      },
                    )
                  }
                  size="sm"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className={cn("size-4", startDomainConnectMutation.isPending && "animate-spin")}
                    icon={startDomainConnectMutation.isPending ? Loading03Icon : Globe02Icon}
                  />
                  Connect DNS
                </Button>
              ))}
          </div>
        </SettingsCard>

        <div
          aria-label="Required DNS records"
          className="@container overflow-hidden rounded-lg border border-border/70 bg-background/58 squircle"
          role="table"
        >
          <div
            className="hidden grid-cols-[minmax(8rem,0.8fr)_minmax(9rem,1.1fr)_minmax(12rem,1.8fr)_6rem_7rem] gap-4 border-b border-border/70 bg-muted/20 px-5 py-2.5 text-[0.65rem] font-medium tracking-[0.12em] text-muted-foreground uppercase @3xl:grid"
            role="row"
          >
            <span role="columnheader">Record</span>
            <span role="columnheader">Host</span>
            <span role="columnheader">Value</span>
            <span role="columnheader">Priority</span>
            <span role="columnheader">State</span>
          </div>
          {domain.requiredDnsRecords.map((record) => {
            const check = dnsChecks.find(
              (candidate) =>
                candidate.recordName === record.name && candidate.purpose === record.purpose,
            );
            return (
              <div
                className={cn(
                  "@container grid gap-4 border-b border-border/70 p-4 last:border-b-0 @md:px-5",
                  "@3xl:grid-cols-[minmax(8rem,0.8fr)_minmax(9rem,1.1fr)_minmax(12rem,1.8fr)_6rem_7rem] @3xl:items-center",
                )}
                key={`${record.type}:${record.name}:${record.value}`}
                role="row"
              >
                <div role="cell">
                  <p className="text-sm font-medium text-foreground">
                    {dnsRecordCopy[record.purpose].label}
                  </p>
                  <p className="mt-1 text-xs/5 text-muted-foreground">
                    {record.type} — {dnsRecordCopy[record.purpose].description}
                  </p>
                </div>
                <div role="cell">
                  <CopyValue label="Host" value={record.name} />
                </div>
                <div role="cell">
                  <CopyValue label="Value" value={record.value} />
                </div>
                <div role="cell">
                  <span className="text-[0.65rem] font-medium tracking-[0.12em] text-muted-foreground uppercase @3xl:hidden">
                    Priority
                  </span>
                  <p className="mt-1 font-mono text-xs text-foreground @3xl:mt-0">
                    {record.priority ?? "—"}
                  </p>
                </div>
                <div role="cell">
                  <RecordState
                    message={check ? (check.ok ? "Verified" : "Fix record") : "Pending"}
                    ok={check?.ok ?? null}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

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
                description: "Sending plus shared inboxes and incoming message routing.",
                label: "Send and receive",
                value: "send_and_receive" as const,
              },
            ].map((option) => {
              const selected = domain.mode === option.value;
              const blockedReason =
                option.value === "send_only" ? data.modeChangeBlockedReason : null;
              return (
                <div
                  className={cn(
                    "flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between",
                    settingsRowPaddingClass,
                  )}
                  key={option.value}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{option.label}</p>
                    <p className="mt-1 text-xs/5 text-muted-foreground">
                      {blockedReason ?? option.description}
                    </p>
                  </div>
                  {selected ? (
                    <RecordState message="Current" ok />
                  ) : manageReason || blockedReason ? (
                    <MutedActionButton
                      icon={<HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />}
                      label="Switch"
                      reason={manageReason ?? blockedReason ?? ""}
                    />
                  ) : (
                    <Button
                      disabled={updateModeMutation.isPending}
                      onClick={() =>
                        updateModeMutation.mutate(
                          {
                            domainId,
                            mode: option.value,
                            organizationId: organization.id,
                          },
                          {
                            onError: (mutationError) =>
                              toast.error(
                                mutationError instanceof Error
                                  ? mutationError.message
                                  : "Could not update mail mode.",
                              ),
                          },
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      Switch
                    </Button>
                  )}
                </div>
              );
            })}
          </SettingsInsetRows>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        description="Authentication records protect deliverability and make impersonation harder."
        title="Delivery and reputation"
      >
        <SettingsCard>
          <SettingsInsetRows>
            {[
              ["DKIM signing", "dkim"],
              ["SPF authorization", "mail_from_spf"],
              ["DMARC policy", "dmarc"],
            ].map(([label, purpose]) => {
              const checks = dnsChecks.filter((check) => check.purpose === purpose);
              const ready = checks.length > 0 && checks.every((check) => check.ok);
              return (
                <div
                  className={cn("flex items-center justify-between gap-4", settingsRowPaddingClass)}
                  key={purpose}
                >
                  <span className="text-sm text-foreground">{label}</span>
                  <RecordState
                    message={ready ? "Ready" : checks.length > 0 ? "Needs attention" : "Pending"}
                    ok={checks.length > 0 ? ready : null}
                  />
                </div>
              );
            })}
          </SettingsInsetRows>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        description="Removal releases the domain from this team. DNS records are not removed at your provider."
        title="Danger zone"
      >
        <SettingsCard className="p-5">
          <div className="@container flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Remove domain</p>
              <p className="mt-1 text-xs/5 text-muted-foreground">
                {data.managedMailboxCount > 0
                  ? `Remove or migrate ${data.managedMailboxCount} shared ${data.managedMailboxCount === 1 ? "inbox" : "inboxes"} first.`
                  : "This stops Quieter from sending or receiving mail for the domain."}
              </p>
            </div>
            {manageReason || data.managedMailboxCount > 0 ? (
              <MutedActionButton
                icon={<HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />}
                label="Remove"
                reason={
                  manageReason ??
                  "Shared inboxes must be removed or migrated before removing this domain."
                }
              />
            ) : (
              <Button onClick={() => setRemoveOpen(true)} size="sm" variant="destructive">
                <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
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
            <DialogDescription>This action disconnects the domain from Quieter.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3 text-sm text-muted-foreground">
            <p>Sending and incoming mail will stop for this domain.</p>
            <p>Remove the DNS records at your provider after this domain is disconnected.</p>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton disabled={removeMutation.isPending}>Cancel</DialogCloseButton>
            <Button
              disabled={removeMutation.isPending}
              onClick={() =>
                removeMutation.mutate(
                  { domainId, organizationId: organization.id },
                  {
                    onError: (mutationError) =>
                      toast.error(
                        mutationError instanceof Error
                          ? mutationError.message
                          : "Could not remove domain.",
                      ),
                  },
                )
              }
              size="sm"
              variant="destructive"
            >
              <HugeiconsIcon
                aria-hidden
                className={cn("size-4", removeMutation.isPending && "animate-spin")}
                icon={removeMutation.isPending ? Loading03Icon : Delete02Icon}
              />
              Remove domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
