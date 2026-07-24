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
import { useEffect, useRef, useState } from "react";
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
  getOrganizationDomainConnectQueryKey,
  getOrganizationMailDomainQueryKey,
  getOrganizationMailDomainsQueryKey,
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
  if (!value) return "Not yet";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const dnsTableColumns =
  "grid grid-cols-[3.25rem_minmax(7rem,0.85fr)_minmax(10rem,1.6fr)_4rem_3.25rem_5.25rem] items-center gap-3";

const DnsCopyCell = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  return (
    <button
      aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
      className={cn(
        "max-w-full min-w-0 rounded-md px-1.5 py-0.5 text-left font-mono text-xs outline-none squircle",
        "transition-[transform,background-color,color] duration-100 ease-out",
        "hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30",
        "active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
        copied ? "bg-success/15 text-success" : "text-foreground",
      )}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
            resetTimerRef.current = setTimeout(() => setCopied(false), 1100);
          },
          () => toast.error("Could not copy to clipboard."),
        );
      }}
      title={copied ? "Copied" : `Copy ${value}`}
      type="button"
    >
      <span className="block truncate">{value}</span>
    </button>
  );
};

const RecordState = ({ message, ok }: { message: string; ok: boolean | null }) => (
  <span
    className={cn(
      "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
      ok === true
        ? "bg-success/15 text-success"
        : ok === false
          ? "bg-destructive/10 text-destructive"
          : "bg-muted/40 text-muted-foreground",
    )}
  >
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
        queryKey: getOrganizationDomainConnectQueryKey(organization.id, domainId),
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
    mutationKey: getOrganizationDomainConnectQueryKey(organization.id, domainId),
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
  const requiredDnsRecords = domain.requiredDnsRecords.filter(
    (record) => record.required && record.purpose !== "dmarc",
  );
  const requiredDnsChecks = dnsChecks.filter((check) =>
    requiredDnsRecords.some(
      (record) => record.name === check.recordName && record.purpose === check.purpose,
    ),
  );
  const passingRecords = requiredDnsChecks.filter((check) => check.ok).length;
  const totalRecords = requiredDnsRecords.length;
  const remainingRecords = Math.max(0, totalRecords - passingRecords);
  const isVerified = resolveMailDomainVerified(domain);
  const verifiedSendingChecks =
    domain.lastCheckResult?.checks.filter(
      (check) =>
        (check.purpose === "ses_identity" || check.purpose === "ses_mail_from") && check.ok,
    ).length ?? 0;
  const status = isVerified
    ? {
        description:
          verifiedSendingChecks === 2
            ? "Every required check is passing."
            : "All DNS records are ready. Sending may still catch up for a short while.",
        label: "Verified",
        tone: "success" as const,
      }
    : passingRecords > 0
      ? {
          description: `${passingRecords} of ${totalRecords} DNS records are ready. Fix the remaining ${remainingRecords}.`,
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
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <SettingsSection
        description="Use one-click setup when your provider confirms support, or add every record manually."
        title="DNS setup"
      >
        {(domainConnectAvailability?.available || isDomainConnectPending) && (
          <SettingsCard className="@container p-3.5 @md:px-4">
            <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {domainConnectAvailability?.available
                    ? `Connect with ${domainConnectAvailability.provider.displayName}`
                    : "Checking your DNS provider…"}
                </p>
                {domainConnectAvailability?.available ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Authorize the exact records, then Quieter verifies DNS when you return.
                  </p>
                ) : null}
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
                      className={cn(
                        "size-4",
                        startDomainConnectMutation.isPending && "animate-spin",
                      )}
                      icon={startDomainConnectMutation.isPending ? Loading03Icon : Globe02Icon}
                    />
                    Connect DNS
                  </Button>
                ))}
            </div>
          </SettingsCard>
        )}

        <div
          aria-label="DNS records"
          className="overflow-x-auto rounded-lg border border-border/70 bg-background/58 squircle"
          role="table"
        >
          <div className="min-w-160 p-2">
            <div
              className={cn(
                dnsTableColumns,
                "rounded-md bg-muted/35 px-3 py-1.5 text-xs font-medium text-muted-foreground",
              )}
              role="row"
            >
              <span role="columnheader">Type</span>
              <span role="columnheader">Host</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Priority</span>
              <span role="columnheader">TTL</span>
              <span role="columnheader">Status</span>
            </div>
            {domain.requiredDnsRecords.map((record) => {
              const check = dnsChecks.find(
                (candidate) =>
                  candidate.recordName === record.name && candidate.purpose === record.purpose,
              );
              const priority = record.priority == null ? null : String(record.priority);
              return (
                <div
                  className={cn(
                    dnsTableColumns,
                    "border-b border-border/50 px-3 py-1.5 last:border-b-0",
                  )}
                  key={`${record.type}:${record.name}:${record.value}`}
                  role="row"
                >
                  <div className="min-w-0" role="cell">
                    <DnsCopyCell value={record.type} />
                  </div>
                  <div className="min-w-0" role="cell">
                    <DnsCopyCell value={record.name} />
                  </div>
                  <div className="min-w-0" role="cell">
                    <DnsCopyCell value={record.value} />
                  </div>
                  <div className="min-w-0" role="cell">
                    {priority ? (
                      <DnsCopyCell value={priority} />
                    ) : (
                      <span className="px-1.5 font-mono text-xs text-muted-foreground">-</span>
                    )}
                  </div>
                  <div className="min-w-0 px-1.5 text-xs text-foreground" role="cell">
                    Auto
                  </div>
                  <div role="cell">
                    <RecordState
                      message={
                        check?.ok
                          ? "Verified"
                          : record.required
                            ? check
                              ? "Fix"
                              : "Pending"
                            : "Recommended"
                      }
                      ok={check?.ok ? true : record.required ? (check?.ok ?? null) : null}
                    />
                  </div>
                </div>
              );
            })}
          </div>
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
            {(
              [
                {
                  label: "DKIM signing",
                  purpose: "dkim",
                  required: true,
                },
                {
                  label: "SPF authorization",
                  purpose: "mail_from_spf",
                  required: true,
                },
                {
                  label: "DMARC policy",
                  purpose: "dmarc",
                  required: false,
                },
              ] as const
            ).map((item) => {
              const checks = dnsChecks.filter((check) => check.purpose === item.purpose);
              const ready = checks.length > 0 && checks.every((check) => check.ok);
              return (
                <div
                  className={cn("flex items-center justify-between gap-4", settingsRowPaddingClass)}
                  key={item.purpose}
                >
                  <div>
                    <span className="text-sm text-foreground">{item.label}</span>
                    {item.required ? null : (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Recommended. Any valid policy works; quarantine is preferred.
                      </p>
                    )}
                  </div>
                  <RecordState
                    message={
                      ready
                        ? "Ready"
                        : item.required
                          ? checks.length > 0
                            ? "Needs attention"
                            : "Pending"
                          : "Recommended"
                    }
                    ok={ready ? true : item.required ? (checks.length > 0 ? false : null) : null}
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
