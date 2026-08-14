"use client";

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

import { BillingProductCard } from "#/features/settings/components/billing-product-card";
import {
  getOrganizationApiKeysQueryKey,
  organizationApiKeysQueryOptions,
} from "#/features/settings/components/organization-settings/api-keys";
import {
  organizationMailDomainsQueryOptions,
  resolveMailDomainVerified,
} from "#/features/settings/components/organization-settings/mail-domains";
import type { OrganizationMailDomain } from "#/features/settings/components/organization-settings/mail-domains";
import { RegisterDomainDialog } from "#/features/settings/components/organization-settings/register-domain-dialog";
import {
  getTeamBilling,
  normalizeBillingProduct,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "#/features/settings/domain/billing";
import { authClient } from "#/lib/auth";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

type FirstRunOrganization = {
  id: string;
  mailboxes: { provider: "gmail" | "managed" }[];
  name: string;
};

const setupSteps = [
  { icon: Wallet02Icon, id: "billing", label: "Billing" },
  { icon: Globe02Icon, id: "domain", label: "Domain" },
  { icon: Mail01Icon, id: "mailbox", label: "Mailbox" },
  { icon: Key02Icon, id: "api-key", label: "API key" },
] as const;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getOrganizationName = (
  organizations: FirstRunOrganization[],
  organizationId: string
) =>
  organizations.find((organization) => organization.id === organizationId)
    ?.name ?? "Organization";

type BillingProduct = ReturnType<typeof normalizeBillingProduct>;

const FirstRunSetupHeader = ({
  onBack,
  onOrganizationChange,
  organizationId,
  organizations,
}: {
  onBack: () => void;
  onOrganizationChange: (organizationId: string) => void;
  organizationId: string;
  organizations: FirstRunOrganization[];
}) => (
  <div className="flex flex-col gap-4 border-b border-border p-5 @3xl:flex-row @3xl:items-start @3xl:justify-between">
    <div>
      <Button
        className="mb-3 -ml-2 text-muted-fg"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={ArrowLeft01Icon} />
        Back
      </Button>
      <h1 className="text-lg font-semibold tracking-tight text-fg">
        Set up managed mail
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-fg">
        Send and receive from your own domain with managed mailboxes and API
        keys.
      </p>
    </div>
    <Select
      items={organizations.map((organization) => ({
        label: organization.name,
        value: organization.id,
      }))}
      onValueChange={(value) => {
        onOrganizationChange(value ?? "");
      }}
      value={organizationId}
    >
      <SelectTrigger aria-label="Organization" className="w-full @3xl:w-60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {organizations.map((organization) => (
          <SelectItem key={organization.id} value={organization.id}>
            {organization.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const FirstRunSetupNavigation = ({
  stepStatus,
}: {
  stepStatus: Record<(typeof setupSteps)[number]["id"], boolean>;
}) => (
  <nav className="border-b border-border p-4 @3xl:border-r @3xl:border-b-0">
    <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-1">
      {setupSteps.map((step) => (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
            {
              "bg-secondary/40 text-muted-fg": !stepStatus[step.id],
              "bg-success/10 text-success": stepStatus[step.id],
            }
          )}
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
);

const FirstRunBillingStep = ({
  canManageBilling,
  currentProduct,
  hasManagedAccess,
  isBillingPending,
  isCheckoutPending,
  isStartingCheckout,
  onCheckout,
  organizationName,
}: {
  canManageBilling: boolean;
  currentProduct: BillingProduct;
  hasManagedAccess: boolean;
  isBillingPending: boolean;
  isCheckoutPending: boolean;
  isStartingCheckout: (product: "managed" | "pro") => boolean;
  onCheckout: (product: "managed" | "pro") => void;
  organizationName: string;
}) => {
  const accessContent = hasManagedAccess ? (
    <p className="inline-flex items-center gap-2 text-sm text-success">
      <HugeiconsIcon
        aria-hidden
        className="size-4"
        icon={CheckmarkCircle01Icon}
      />
      Managed mail is active for this organization.
    </p>
  ) : (
    <div className="grid gap-3 @5xl:grid-cols-2">
      {(["managed", "pro"] as const).map((product) => (
        <BillingProductCard
          canChoose={canManageBilling}
          currentProduct={currentProduct}
          isAnyCheckoutPending={isCheckoutPending}
          isStartingCheckout={isStartingCheckout(product)}
          key={product}
          onCheckout={() => {
            onCheckout(product);
          }}
          productId={product}
        />
      ))}
    </div>
  );
  const content = isBillingPending ? (
    <p className="inline-flex items-center gap-2 text-sm text-muted-fg">
      <HugeiconsIcon
        aria-hidden
        className="size-4 animate-spin"
        icon={Loading03Icon}
      />
      Loading billing…
    </p>
  ) : (
    accessContent
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-fg">
          1. Choose managed access
        </h2>
        <p className="mt-1 text-sm text-muted-fg">
          Managed mail requires a Managed or Pro subscription for{" "}
          {organizationName}.
        </p>
      </div>
      {content}
    </section>
  );
};

const FirstRunDomainStep = ({
  hasManagedAccess,
  onCreated,
  organizationId,
  verifiedDomains,
}: {
  hasManagedAccess: boolean;
  onCreated: (domainId: string) => void;
  organizationId: string;
  verifiedDomains: OrganizationMailDomain[];
}) => {
  const content =
    verifiedDomains.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {verifiedDomains.map((verifiedDomain) => (
          <span
            className="rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-sm text-success"
            key={verifiedDomain.id}
          >
            {verifiedDomain.domain}
          </span>
        ))}
        <RegisterDomainDialog
          onCreated={onCreated}
          organizationId={organizationId}
        >
          <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
          Add another
        </RegisterDomainDialog>
      </div>
    ) : (
      <RegisterDomainDialog
        onCreated={onCreated}
        organizationId={organizationId}
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
        Register domain
      </RegisterDomainDialog>
    );

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div>
        <h2 className="text-sm font-medium text-fg">2. Verify your domain</h2>
        <p className="mt-1 text-sm text-muted-fg">
          Add a domain so Quieter can create managed mailboxes for your
          addresses.
        </p>
      </div>
      {hasManagedAccess ? (
        content
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled size="sm" type="button">
            <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
            Register domain
          </Button>
          <p className="text-sm text-muted-fg">
            Choose billing before verifying a domain.
          </p>
        </div>
      )}
    </section>
  );
};

const FirstRunMailboxStep = ({
  createPending,
  domain,
  hasManagedAccess,
  hasManagedMailbox,
  isDomainsPending,
  localPart,
  onCreate,
  onLocalPartChange,
  onSelectedDomainChange,
  selectedDomain,
  verifiedDomains,
}: {
  createPending: boolean;
  domain: string;
  hasManagedAccess: boolean;
  hasManagedMailbox: boolean;
  isDomainsPending: boolean;
  localPart: string;
  onCreate: () => void;
  onLocalPartChange: (value: string) => void;
  onSelectedDomainChange: (value: string | undefined) => void;
  selectedDomain: string;
  verifiedDomains: OrganizationMailDomain[];
}) => (
  <section className="space-y-3 border-t border-border pt-5">
    <div>
      <h2 className="text-sm font-medium text-fg">
        3. Create a managed mailbox
      </h2>
      <p className="mt-1 text-sm text-muted-fg">
        Start with an address like support@yourdomain.com.
      </p>
    </div>
    {hasManagedMailbox ? (
      <p className="inline-flex items-center gap-2 text-sm text-success">
        <HugeiconsIcon
          aria-hidden
          className="size-4"
          icon={CheckmarkCircle01Icon}
        />
        This organization already has a managed mailbox.
      </p>
    ) : (
      <div className="flex flex-wrap items-center gap-3">
        <div className="squircle flex h-9 w-full max-w-md items-center rounded-md border border-border bg-bg-elevated shadow-sm transition-colors">
          <TextFieldInput
            aria-label="Managed mailbox local part"
            chrome="ghost"
            className="h-full min-w-0 flex-1 pr-1"
            onChange={(event) => {
              onLocalPartChange(
                event.currentTarget.value.replaceAll(/[@\s]/gu, "")
              );
            }}
            placeholder="support"
            value={localPart}
          />
          <span aria-hidden className="text-sm text-muted-fg select-none">
            @
          </span>
          {verifiedDomains.length > 0 ? (
            <Select
              items={verifiedDomains.map((verifiedDomain) => ({
                label: verifiedDomain.domain,
                value: verifiedDomain.domain,
              }))}
              onValueChange={(value) => {
                onSelectedDomainChange(value ?? undefined);
              }}
              value={selectedDomain}
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
                  <SelectItem
                    key={verifiedDomain.id}
                    value={verifiedDomain.domain}
                  >
                    {verifiedDomain.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="px-2.5 text-sm text-muted-fg">
              {isDomainsPending ? "loading…" : "verified domain"}
            </span>
          )}
        </div>
        <Button
          disabled={
            !hasManagedAccess ||
            localPart.trim() === "" ||
            domain === "" ||
            createPending
          }
          onClick={onCreate}
          size="sm"
          type="button"
        >
          {createPending && (
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
);

const FirstRunApiKeyStep = ({
  createdApiKey,
  hasApiKey,
  hasManagedAccess,
  isPending,
  onCreate,
}: {
  createdApiKey: string | null;
  hasApiKey: boolean;
  hasManagedAccess: boolean;
  isPending: boolean;
  onCreate: () => void;
}) => {
  const hasCreatedApiKey = createdApiKey !== null && createdApiKey !== "";
  const renderApiKeyBody = () => {
    if (hasCreatedApiKey) {
      return (
        <div className="space-y-3">
          <p className="inline-flex items-center gap-2 text-sm text-success">
            <HugeiconsIcon
              aria-hidden
              className="size-4"
              icon={CheckmarkCircle01Icon}
            />
            API key created. Store it before leaving this screen.
          </p>
          <button
            className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-xs break-all text-fg hover:bg-secondary/50"
            onClick={() => {
              if (createdApiKey !== null) {
                void navigator.clipboard.writeText(createdApiKey);
                toast.success("Copied API key to clipboard.");
              }
            }}
            type="button"
          >
            {createdApiKey}
          </button>
          <a
            className="squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-bg-surface px-3.5 text-[13px] text-fg shadow-sm transition-transform duration-100 ease-out select-none hover:bg-muted/60 active:scale-[0.97] active:bg-muted/80"
            href="/api/openapi"
            rel="noreferrer"
            target="_blank"
          >
            Open API reference
          </a>
        </div>
      );
    }

    if (hasApiKey) {
      return (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm text-success">
            <HugeiconsIcon
              aria-hidden
              className="size-4"
              icon={CheckmarkCircle01Icon}
            />
            This organization already has an API key.
          </p>
          <a
            className="squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-bg-surface px-3.5 text-[13px] text-fg shadow-sm transition-transform duration-100 ease-out select-none hover:bg-muted/60 active:scale-[0.97] active:bg-muted/80"
            href="/api/openapi"
            rel="noreferrer"
            target="_blank"
          >
            Open API reference
          </a>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!hasManagedAccess || isPending}
          onClick={onCreate}
          size="sm"
          type="button"
        >
          {isPending ? (
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
          className="squircle inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-[13px] text-muted-fg transition-transform duration-100 ease-out select-none hover:bg-muted/60 hover:text-fg active:scale-[0.97] active:bg-muted/60 active:text-fg"
          href="/api/openapi"
          rel="noreferrer"
          target="_blank"
        >
          Open API reference
        </a>
      </div>
    );
  };

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div>
        <h2 className="text-sm font-medium text-fg">4. Create an API key</h2>
        <p className="mt-1 text-sm text-muted-fg">
          Use an organization API key to send messages through{" "}
          <span className="font-mono">/api/v1/send</span>.
        </p>
      </div>
      {renderApiKeyBody()}
    </section>
  );
};

export const FirstRunManagedMailSetup = ({
  onBack,
  organizations,
}: {
  onBack: () => void;
  organizations: FirstRunOrganization[];
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authOrganizations = authClient.useListOrganizations().data;
  const organizationNames = new Map(
    (authOrganizations ?? []).map((organization) => [
      organization.id,
      organization.name,
    ])
  );
  const selectableOrganizations = organizations.map((organization) => ({
    ...organization,
    name: organizationNames.get(organization.id) ?? organization.name,
  }));
  const [organizationId, setOrganizationId] = useState(
    selectableOrganizations[0]?.id ?? ""
  );
  const [localPart, setLocalPart] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const selectedOrganization = selectableOrganizations.find(
    (organization) => organization.id === organizationId
  );
  const organizationName = getOrganizationName(
    selectableOrganizations,
    organizationId
  );
  const { data: billing, isPending: isBillingPending } = useQuery(
    userBillingQueryOptions()
  );
  const teamBilling = getTeamBilling(billing, organizationId);
  const currentProduct = normalizeBillingProduct(teamBilling?.product);
  const hasManagedAccess = teamBilling?.hasAccess === true;
  const canManageBilling = teamBilling?.canManageBilling === true;
  const { data: domainsData, isPending: isDomainsPending } = useQuery({
    ...organizationMailDomainsQueryOptions(organizationId),
    enabled: organizationId.length > 0,
  });
  const { data: apiKeysData } = useQuery({
    ...organizationApiKeysQueryOptions(organizationId),
    enabled: organizationId.length > 0 && hasManagedAccess,
  });
  const verifiedDomains = (domainsData?.domains ?? []).filter(
    (domain) =>
      resolveMailDomainVerified(domain) && domain.mode === "send_and_receive"
  );
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>();
  const domain = selectedDomain ?? verifiedDomains[0]?.domain ?? "";
  const hasManagedMailbox =
    selectedOrganization?.mailboxes.some(
      (mailbox) => mailbox.provider === "managed"
    ) === true;
  const hasApiKey = (apiKeysData?.apiKeys ?? []).length > 0;
  const trimmedLocalPart = localPart.trim();
  const openRegisteredDomain = (domainId: string) => {
    void navigate({
      search: {
        domainId,
        organizationId,
        organizationView: "domains",
        tab: "organization",
      },
      to: "/settings",
    });
  };
  const checkoutMutation = useMutation({
    ...orpc.billing.createCheckout.mutationOptions(),
    onError: (error) =>
      toast.error(error.message || "Could not start checkout."),
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
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not create API key.")),
    onSuccess: async (result) => {
      // Only apply the response if it matches the currently selected organization
      if (result.organizationId === organizationId) {
        setCreatedApiKey(result.key);
        void navigator.clipboard.writeText(result.key);
        toast.success("API key created and copied.");
      }
      // Always invalidate for the originating organization
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(result.organizationId),
      });
    },
  });

  const stepStatus = {
    "api-key": hasApiKey,
    billing: hasManagedAccess,
    domain: verifiedDomains.length > 0,
    mailbox: hasManagedMailbox,
  } satisfies Record<(typeof setupSteps)[number]["id"], boolean>;

  return (
    <div className="@container mx-auto flex max-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-bg/88 text-left shadow-2xl backdrop-blur-xl">
      <FirstRunSetupHeader
        onBack={onBack}
        onOrganizationChange={(nextOrganizationId) => {
          setOrganizationId(nextOrganizationId);
          setCreatedApiKey(null);
          setSelectedDomain(undefined);
        }}
        organizationId={organizationId}
        organizations={selectableOrganizations}
      />

      <div className="grid min-h-0 flex-1 overflow-hidden @3xl:grid-cols-[15rem_minmax(0,1fr)]">
        <FirstRunSetupNavigation stepStatus={stepStatus} />

        <div className="min-h-0 space-y-6 overflow-y-auto p-5">
          <FirstRunBillingStep
            canManageBilling={canManageBilling}
            currentProduct={currentProduct}
            hasManagedAccess={hasManagedAccess}
            isBillingPending={isBillingPending}
            isCheckoutPending={checkoutMutation.isPending}
            isStartingCheckout={(product) =>
              checkoutMutation.isPending &&
              checkoutMutation.variables?.product === product
            }
            onCheckout={(product) => {
              checkoutMutation.mutate({
                organizationId,
                product,
              });
            }}
            organizationName={organizationName}
          />

          <FirstRunDomainStep
            hasManagedAccess={hasManagedAccess}
            onCreated={openRegisteredDomain}
            organizationId={organizationId}
            verifiedDomains={verifiedDomains}
          />

          <FirstRunMailboxStep
            createPending={createMailboxMutation.isPending}
            domain={domain}
            hasManagedAccess={hasManagedAccess}
            hasManagedMailbox={hasManagedMailbox}
            isDomainsPending={isDomainsPending}
            localPart={localPart}
            onCreate={() => {
              createMailboxMutation.mutate(
                {
                  emailAddress: `${trimmedLocalPart}@${domain}`,
                  organizationId,
                },
                {
                  onError: (error) => {
                    toast.error(
                      getErrorMessage(
                        error,
                        "Could not create managed mailbox."
                      )
                    );
                  },
                }
              );
            }}
            onLocalPartChange={setLocalPart}
            onSelectedDomainChange={setSelectedDomain}
            selectedDomain={domain}
            verifiedDomains={verifiedDomains}
          />

          <FirstRunApiKeyStep
            createdApiKey={createdApiKey}
            hasApiKey={hasApiKey}
            hasManagedAccess={hasManagedAccess}
            isPending={createApiKeyMutation.isPending}
            onCreate={() => {
              createApiKeyMutation.mutate(organizationId);
            }}
          />
        </div>
      </div>
    </div>
  );
};
