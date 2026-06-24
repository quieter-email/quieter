"use client";

import type { BillingProductId } from "@quieter/billing/plans";
import {
  Add01Icon,
  ArrowLeft01Icon,
  CheckmarkCircle01Icon,
  Globe02Icon,
  Key02Icon,
  Loading03Icon,
  Mail01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextFieldInput,
  cn,
  toast,
} from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BillingProductCard } from "~/features/settings/components/billing-product-card";
import {
  getOrganizationApiKeysQueryKey,
  organizationApiKeysQueryOptions,
} from "~/features/settings/components/organization-settings/api-keys";
import { organizationMailDomainsQueryOptions } from "~/features/settings/components/organization-settings/mail-domains";
import { RegisterDomainDialog } from "~/features/settings/components/organization-settings/register-domain-dialog";
import {
  getTeamBilling,
  normalizeBillingProduct,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { authClient } from "~/lib/auth";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

type FirstRunOrganization = {
  id: string;
  mailboxes: Array<{ provider: "gmail" | "managed" }>;
  name: string;
};

const setupSteps = [
  { id: "billing", label: "Billing", icon: Wallet02Icon },
  { id: "domain", label: "Domain", icon: Globe02Icon },
  { id: "mailbox", label: "Mailbox", icon: Mail01Icon },
  { id: "api-key", label: "API key", icon: Key02Icon },
] as const;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getOrganizationName = (organizations: FirstRunOrganization[], organizationId: string) =>
  organizations.find((organization) => organization.id === organizationId)?.name ?? "Organization";

export const FirstRunManagedMailSetup = ({
  onBack,
  organizations,
}: {
  onBack: () => void;
  organizations: FirstRunOrganization[];
}) => {
  const queryClient = useQueryClient();
  const authOrganizations = authClient.useListOrganizations().data ?? [];
  const selectableOrganizations = useMemo(() => {
    const names = new Map(
      authOrganizations.map((organization) => [organization.id, organization.name]),
    );
    return organizations.map((organization) => ({
      ...organization,
      name: names.get(organization.id) ?? organization.name,
    }));
  }, [authOrganizations, organizations]);
  const [organizationId, setOrganizationId] = useState(selectableOrganizations[0]?.id ?? "");
  const [localPart, setLocalPart] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const selectedOrganization = selectableOrganizations.find(
    (organization) => organization.id === organizationId,
  );
  const organizationName = getOrganizationName(selectableOrganizations, organizationId);
  const { data: billing, isPending: isBillingPending } = useQuery(userBillingQueryOptions());
  const teamBilling = getTeamBilling(billing, organizationId);
  const currentProduct = normalizeBillingProduct(teamBilling?.product);
  const hasManagedAccess = teamBilling?.hasAccess === true;
  const canManageBilling = teamBilling?.canManageBilling === true;
  const domainsQuery = useQuery({
    ...organizationMailDomainsQueryOptions(organizationId),
    enabled: organizationId.length > 0,
  });
  const apiKeysQuery = useQuery({
    ...organizationApiKeysQueryOptions(organizationId),
    enabled: organizationId.length > 0 && hasManagedAccess,
  });
  const verifiedDomains = (domainsQuery.data?.domains ?? []).filter(
    (domain) => domain.status === "verified",
  );
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>(undefined);
  const domain = selectedDomain ?? verifiedDomains[0]?.domain ?? "";
  const hasManagedMailbox =
    selectedOrganization?.mailboxes.some((mailbox) => mailbox.provider === "managed") === true;
  const hasApiKey = (apiKeysQuery.data?.apiKeys ?? []).length > 0;
  const trimmedLocalPart = localPart.trim();
  const checkoutMutation = useMutation({
    ...orpc.billing.createCheckout.mutationOptions(),
    onError: (error) => toast.error(error.message || "Could not start checkout."),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      window.location.assign(result.checkoutUrl);
    },
  });
  const createMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailbox.mutationOptions(),
    mutationKey: ["first-run", "managed-mailbox", organizationId],
    onSuccess: async () => {
      setLocalPart("");
      await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
      toast.success("Managed mailbox created.");
    },
  });
  const createApiKeyMutation = useMutation({
    mutationFn: async (requestOrgId: string) => {
      const response = await authClient.apiKey.create({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        expiresIn: 60 * 60 * 24 * 365,
        name: "Managed mail setup",
        organizationId: requestOrgId,
        prefix: "quieter_",
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Could not create API key.");
      }

      if (!response.data?.key) {
        throw new Error("Could not read the created API key.");
      }

      return { key: response.data.key, organizationId: requestOrgId };
    },
    mutationKey: ["first-run", "organization-api-key", organizationId],
    onError: (error) => toast.error(getErrorMessage(error, "Could not create API key.")),
    onSuccess: async (result) => {
      // Only apply the response if it matches the currently selected organization
      if (result.organizationId === organizationId) {
        setCreatedApiKey(result.key);
        await navigator.clipboard.writeText(result.key).catch(() => undefined);
        toast.success("API key created and copied.");
      }
      // Always invalidate for the originating organization
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(result.organizationId),
      });
    },
  });

  const stepStatus = {
    billing: hasManagedAccess,
    domain: verifiedDomains.length > 0,
    mailbox: hasManagedMailbox,
    "api-key": hasApiKey,
  } satisfies Record<(typeof setupSteps)[number]["id"], boolean>;

  return (
    <div className="mx-auto flex max-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border/70 bg-background/88 text-left shadow-2xl backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-border/70 p-5 md:flex-row md:items-start md:justify-between">
        <div>
          <Button
            className="mb-3 -ml-2 text-muted-foreground"
            onClick={onBack}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={ArrowLeft01Icon} />
            Back
          </Button>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Set up managed mail
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Send and receive from your own domain with managed mailboxes and API keys.
          </p>
        </div>
        <Select
          items={selectableOrganizations.map((organization) => ({
            label: organization.name,
            value: organization.id,
          }))}
          onValueChange={(value) => {
            setOrganizationId(value ?? "");
            setCreatedApiKey(null);
            setSelectedDomain(undefined);
          }}
          value={organizationId}
        >
          <SelectTrigger aria-label="Organization" className="w-full md:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {selectableOrganizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="border-b border-border/70 p-4 md:border-r md:border-b-0">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
            {setupSteps.map((step) => (
              <div
                className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm", {
                  "bg-success/10 text-success": stepStatus[step.id],
                  "bg-secondary/40 text-muted-foreground": !stepStatus[step.id],
                })}
                key={step.id}
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4 shrink-0"
                  icon={stepStatus[step.id] ? CheckmarkCircle01Icon : step.icon}
                />
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-h-0 space-y-6 overflow-y-auto p-5">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium text-foreground">1. Choose managed access</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Managed mail requires a Managed or Pro subscription for {organizationName}.
              </p>
            </div>
            {isBillingPending ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                Loading billing…
              </p>
            ) : hasManagedAccess ? (
              <p className="inline-flex items-center gap-2 text-sm text-success">
                <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle01Icon} />
                Managed mail is active for this organization.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {(["managed", "pro"] as const).map((product) => (
                  <BillingProductCard
                    canChoose={canManageBilling}
                    currentProduct={currentProduct}
                    isAnyCheckoutPending={checkoutMutation.isPending}
                    isStartingCheckout={
                      checkoutMutation.isPending && checkoutMutation.variables?.product === product
                    }
                    key={product}
                    onCheckout={() =>
                      checkoutMutation.mutate({
                        organizationId,
                        product: product as BillingProductId,
                      })
                    }
                    productId={product}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border/70 pt-5">
            <div>
              <h2 className="text-sm font-medium text-foreground">2. Verify your domain</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a domain so Quieter can create managed mailboxes for your addresses.
              </p>
            </div>
            {!hasManagedAccess ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled size="sm" type="button">
                  <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
                  Register domain
                </Button>
                <p className="text-sm text-muted-foreground">
                  Choose billing before verifying a domain.
                </p>
              </div>
            ) : verifiedDomains.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {verifiedDomains.map((verifiedDomain) => (
                  <span
                    className="rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-sm text-success"
                    key={verifiedDomain.id}
                  >
                    {verifiedDomain.domain}
                  </span>
                ))}
                <RegisterDomainDialog organizationId={organizationId}>
                  <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
                  Add another
                </RegisterDomainDialog>
              </div>
            ) : (
              <RegisterDomainDialog organizationId={organizationId}>
                <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
                Register domain
              </RegisterDomainDialog>
            )}
          </section>

          <section className="space-y-3 border-t border-border/70 pt-5">
            <div>
              <h2 className="text-sm font-medium text-foreground">3. Create a managed mailbox</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with an address like support@yourdomain.com.
              </p>
            </div>
            {hasManagedMailbox ? (
              <p className="inline-flex items-center gap-2 text-sm text-success">
                <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle01Icon} />
                This organization already has a managed mailbox.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="squircle flex h-9 w-full max-w-md items-center rounded-md border border-input bg-background shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                  <TextFieldInput
                    aria-label="Managed mailbox local part"
                    chrome="ghost"
                    className="h-full min-w-0 flex-1 pr-1"
                    onChange={(event) =>
                      setLocalPart(event.currentTarget.value.replace(/[@\s]/g, ""))
                    }
                    placeholder="support"
                    value={localPart}
                  />
                  <span aria-hidden className="text-sm text-muted-foreground select-none">
                    @
                  </span>
                  {verifiedDomains.length > 0 ? (
                    <Select
                      items={verifiedDomains.map((verifiedDomain) => ({
                        label: verifiedDomain.domain,
                        value: verifiedDomain.domain,
                      }))}
                      onValueChange={(value) => setSelectedDomain(value ?? undefined)}
                      value={domain}
                    >
                      <SelectTrigger
                        aria-label="Managed mailbox domain"
                        className="h-full rounded-l-none pr-2.5 pl-1.5 shadow-none active:scale-100"
                        size="sm"
                        variant="ghost"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {verifiedDomains.map((verifiedDomain) => (
                          <SelectItem key={verifiedDomain.id} value={verifiedDomain.domain}>
                            {verifiedDomain.domain}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="px-2.5 text-sm text-muted-foreground">
                      {domainsQuery.isPending ? "loading…" : "verified domain"}
                    </span>
                  )}
                </div>
                <Button
                  disabled={
                    !hasManagedAccess ||
                    !trimmedLocalPart ||
                    !domain ||
                    createMailboxMutation.isPending
                  }
                  onClick={() =>
                    createMailboxMutation.mutate(
                      {
                        emailAddress: `${trimmedLocalPart}@${domain}`,
                        organizationId,
                      },
                      {
                        onError: (error) =>
                          toast.error(getErrorMessage(error, "Could not create managed mailbox.")),
                      },
                    )
                  }
                  size="sm"
                  type="button"
                >
                  {createMailboxMutation.isPending && (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  )}
                  Create mailbox
                </Button>
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border/70 pt-5">
            <div>
              <h2 className="text-sm font-medium text-foreground">4. Create an API key</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use an organization API key to send messages through{" "}
                <span className="font-mono">/api/messages</span>.
              </p>
            </div>
            {createdApiKey ? (
              <div className="space-y-3">
                <p className="inline-flex items-center gap-2 text-sm text-success">
                  <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle01Icon} />
                  API key created. Store it before leaving this screen.
                </p>
                <button
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-xs break-all text-foreground outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdApiKey);
                    toast.success("Copied API key to clipboard.");
                  }}
                  type="button"
                >
                  {createdApiKey}
                </button>
                <a
                  className="squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background-dark px-3.5 text-[13px] text-foreground shadow-sm transition-transform duration-100 ease-out outline-none select-none hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] active:bg-input/60"
                  href="/api/openapi"
                  rel="noreferrer"
                  target="_blank"
                >
                  Open API reference
                </a>
              </div>
            ) : hasApiKey ? (
              <div className="space-y-2">
                <p className="inline-flex items-center gap-2 text-sm text-success">
                  <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle01Icon} />
                  This organization already has an API key.
                </p>
                <a
                  className="squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background-dark px-3.5 text-[13px] text-foreground shadow-sm transition-transform duration-100 ease-out outline-none select-none hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] active:bg-input/60"
                  href="/api/openapi"
                  rel="noreferrer"
                  target="_blank"
                >
                  Open API reference
                </a>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={!hasManagedAccess || createApiKeyMutation.isPending}
                  onClick={() => createApiKeyMutation.mutate(organizationId)}
                  size="sm"
                  type="button"
                >
                  {createApiKeyMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
                  )}
                  Create API key
                </Button>
                <a
                  className="squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-[13px] text-muted-foreground transition-transform duration-100 ease-out outline-none select-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] active:bg-muted/80 active:text-foreground"
                  href="/api/openapi"
                  rel="noreferrer"
                  target="_blank"
                >
                  Open API reference
                </a>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
