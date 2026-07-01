"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  Delete02Icon,
  Globe02Icon,
  Loading03Icon,
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
import { useState } from "react";
import { orpc } from "~/lib/orpc";
import { SettingsBackButton } from "../settings-layout";
import { formatCount, type FullOrganization } from "./domain";
import {
  formatMailDomainStatus,
  getOrganizationMailDomainsQueryKey,
  organizationMailDomainsQueryOptions,
  type OrganizationMailDomain,
} from "./mail-domains";
import { RegisterDomainDialog } from "./register-domain-dialog";
import { MutedActionButton } from "./settings-row";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

const formatDomainDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const DomainStatusBadge = ({ domain }: { domain: OrganizationMailDomain }) => {
  const verified = domain.status === "verified";

  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-3.5 text-xs font-medium squircle",
        verified
          ? "border-success bg-success/10 text-success"
          : "border-border/70 bg-secondary/40 text-muted-foreground",
      )}
    >
      {verified && <HugeiconsIcon aria-hidden className="size-3.5" icon={CheckmarkCircle01Icon} />}
      {formatMailDomainStatus(domain.status)}
    </span>
  );
};

const RemoveDomainDialog = ({
  domain,
  organizationId,
}: {
  domain: OrganizationMailDomain;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const removeMutation = useMutation({
    ...orpc.mailDomains.remove.mutationOptions(),
    mutationKey: ["mail-domains", organizationId, domain.id, "remove"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getOrganizationMailDomainsQueryKey(organizationId),
      });
    },
  });

  const removeDomain = async () => {
    try {
      await removeMutation.mutateAsync({
        domainId: domain.id,
        organizationId,
      });
      toast.success("Domain removed.");
      setOpen(false);
    } catch (error) {
      toast.error((error as { message?: string })?.message ?? "Could not remove domain.");
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
        Remove
      </Button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove domain</DialogTitle>
            <DialogDescription>{domain.domain}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3 text-sm text-muted-foreground">
            <p>
              This removes the domain from this team and releases it for future registration in
              Quieter.
            </p>
            <p>
              Remove the DNS records as soon as possible. Leaving old records in place can keep mail
              routing or ownership checks active outside Quieter.
            </p>
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton disabled={removeMutation.isPending}>Cancel</DialogCloseButton>
            <Button
              disabled={removeMutation.isPending}
              onClick={() => {
                void removeDomain();
              }}
              size="sm"
              variant="destructive"
            >
              {removeMutation.isPending ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
              )}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const DomainRow = ({
  canManageDomains,
  domain,
  manageDomainsReason,
  organizationId,
}: {
  canManageDomains: boolean;
  domain: OrganizationMailDomain;
  manageDomainsReason: string | null;
  organizationId: string;
}) => (
  <div className="flex flex-col gap-3 border-b border-border/70 py-4 last:border-b-0 md:flex-row md:items-center md:justify-between">
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          icon={Globe02Icon}
        />
        <p className="truncate text-sm font-medium text-foreground">{domain.domain}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {domain.verifiedAt ? `Verified ${formatDomainDate(domain.verifiedAt)}` : "Not verified"}
      </p>
    </div>

    <div className="flex items-center gap-2">
      <DomainStatusBadge domain={domain} />
      {canManageDomains && domain.status !== "verified" ? (
        manageDomainsReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />}
            label="Continue"
            reason={manageDomainsReason}
          />
        ) : (
          <RegisterDomainDialog domain={domain} organizationId={organizationId}>
            <HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />
            Continue
          </RegisterDomainDialog>
        )
      ) : null}
      {canManageDomains && <RemoveDomainDialog domain={domain} organizationId={organizationId} />}
    </div>
  </div>
);

export const DomainsView = ({
  billingAccessUnknown,
  billingPending,
  canManageDomains,
  canUseOrganizationDomains,
  onBack,
  organization,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageDomains: boolean;
  canUseOrganizationDomains: boolean;
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const {
    data: domainsData,
    error: domainsError,
    isError: isDomainsError,
    isPending: isDomainsPending,
  } = useQuery(organizationMailDomainsQueryOptions(organization.id));
  const domains = domainsData?.domains ?? [];
  const manageDomainsReason =
    (billingPending && "Loading billing access…") ||
    (billingAccessUnknown && "Could not load billing access.") ||
    (!canUseOrganizationDomains &&
      `Registering domains requires ${BILLING_FEATURES.organizationDomains.requirementLabel} billing.`) ||
    (!canManageDomains && "Only admins and owners can register team domains.") ||
    null;

  return (
    <div className="space-y-6">
      <SettingsBackButton onClick={onBack}>{organization.name}</SettingsBackButton>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Domains</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCount(domains.length, "Domain", "Domains")}
          </p>
        </div>

        {manageDomainsReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />}
            label="Register"
            reason={manageDomainsReason}
          />
        ) : (
          <RegisterDomainDialog organizationId={organization.id} />
        )}
      </div>

      <div>
        {isDomainsPending ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            Loading domains…
          </div>
        ) : isDomainsError ? (
          <p className="py-6 text-sm text-destructive">
            {domainsError?.message ?? "Could not load domains."}
          </p>
        ) : domains.length > 0 ? (
          domains.map((domain) => (
            <DomainRow
              canManageDomains={canManageDomains}
              domain={domain}
              key={domain.id}
              manageDomainsReason={manageDomainsReason}
              organizationId={organization.id}
            />
          ))
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No domains registered.</p>
        )}
      </div>
    </div>
  );
};
