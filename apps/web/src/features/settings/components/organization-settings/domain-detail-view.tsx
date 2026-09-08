"use client";

import { Loading03Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";
import { settingsRouteApi } from "#/lib/route-apis";

import {
  SettingsBackButton,
  SettingsCard,
  SettingsLoadingState,
  SettingsPageHeader,
} from "../settings-layout";
import { BillingAccessNotice } from "./billing-access-notice";
import type { FullOrganization } from "./domain";
import { DomainDangerSection } from "./domain-danger-section";
import { DomainStatusSummary, DomainDnsSetupSection } from "./domain-dns-setup";
import {
  DomainMailModeSection,
  DomainCatchAllSection,
  DomainDeliverySection,
} from "./domain-mail-routing";
import { getDomainVerificationStatus } from "./domain-status";
import type { DomainDetail } from "./domain-status";
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
              className={cn("size-4", { "animate-spin": verifyPending })}
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
      await queryClient.invalidateQueries({
        queryKey: ["mail", "managed-mailbox-details"],
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
      {!billingPending &&
        !billingAccessUnknown &&
        !canUseOrganizationDomains && (
          <BillingAccessNotice organizationId={organization.id} />
        )}
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
        incomingReady={
          domain.mode === "send_and_receive" && domain.status === "verified"
        }
        manageReason={manageReason}
        organizationId={organization.id}
        setCatchAllMutation={setCatchAllMutation}
      />
      <DomainDeliverySection dnsChecks={dnsChecks} />
      <DomainDangerSection
        data={data}
        domain={domain}
        manageReason={
          canManageDomains
            ? null
            : "Only admins and owners can remove team domains."
        }
        onRemove={handleRemoveDomain}
        removeMutation={removeMutation}
        removeOpen={removeOpen}
        setRemoveOpen={setRemoveOpen}
      />
    </div>
  );
};
