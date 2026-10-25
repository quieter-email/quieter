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
import { BillingProductCard } from "@quieter/app/features/settings/components/billing-product-card";
import {
  getOrganizationApiKeysQueryKey,
  organizationApiKeysQueryOptions,
} from "@quieter/app/features/settings/components/organization-settings/api-keys";
import {
  organizationMailDomainsQueryOptions,
  resolveMailDomainVerified,
} from "@quieter/app/features/settings/components/organization-settings/mail-domains";
import type { OrganizationMailDomain } from "@quieter/app/features/settings/components/organization-settings/mail-domains";
import { RegisterDomainDialog } from "@quieter/app/features/settings/components/organization-settings/register-domain-dialog";
import {
  getTeamBilling,
  normalizeBillingProduct,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "@quieter/app/features/settings/domain/billing";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { rethrowClassified } from "@quieter/app/lib/orpc-errors";
import { getApiUrl, openExternalUrl } from "@quieter/app/runtime";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { Button, buttonVariants } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { InputAddon, InputGroup } from "@quieter/ui/input-group";
import { Pill } from "@quieter/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

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
      <Button className="mb-3 -ml-2" onClick={onBack} size="sm" variant="ghost">
        <Icon aria-hidden icon={ArrowLeft01Icon} />
        Back
      </Button>
      <Text as="h1" size="lg" weight="medium">
        Set up managed mail
      </Text>
      <Text className="mt-1 max-w-2xl" size="sm" tone="muted">
        Send and receive from your own domain with managed mailboxes and API
        keys.
      </Text>
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
            "flex items-center gap-2 rounded-md px-3 py-2 text-body",
            {
              "bg-muted/40 text-muted-fg": !stepStatus[step.id],
              "bg-success/10 text-success": stepStatus[step.id],
            }
          )}
          key={step.id}
        >
          <Icon
            aria-hidden

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
    <p className="inline-flex items-center gap-2 text-body text-success">
      <Icon aria-hidden icon={CheckmarkCircle01Icon} />
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
    <p className="inline-flex items-center gap-2 text-body text-muted-fg">
      <Icon aria-hidden animation="spin" icon={Loading03Icon} />
      Loading billing…
    </p>
  ) : (
    accessContent
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-body font-medium text-fg">
          1. Choose managed access
        </h2>
        <p className="mt-1 text-body text-muted-fg">
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
          <Pill key={verifiedDomain.id} tone="success">
            {verifiedDomain.domain}
          </Pill>
        ))}
        <RegisterDomainDialog
          onCreated={onCreated}
          organizationId={organizationId}
        >
          <Icon aria-hidden icon={Add01Icon} />
          Add another
        </RegisterDomainDialog>
      </div>
    ) : (
      <RegisterDomainDialog
        onCreated={onCreated}
        organizationId={organizationId}
      >
        <Icon aria-hidden icon={Globe02Icon} />
        Register domain
      </RegisterDomainDialog>
    );

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div>
        <h2 className="text-body font-medium text-fg">2. Verify your domain</h2>
        <p className="mt-1 text-body text-muted-fg">
          Add a domain so Quieter can create managed mailboxes for your
          addresses.
        </p>
      </div>
      {hasManagedAccess ? (
        content
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled size="sm" type="button">
            <Icon aria-hidden icon={Globe02Icon} />
            Register domain
          </Button>
          <p className="text-body text-muted-fg">
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
      <h2 className="text-body font-medium text-fg">
        3. Create a managed mailbox
      </h2>
      <p className="mt-1 text-body text-muted-fg">
        Start with an address like support@yourdomain.com.
      </p>
    </div>
    {hasManagedMailbox ? (
      <p className="inline-flex items-center gap-2 text-body text-success">
        <Icon aria-hidden icon={CheckmarkCircle01Icon} />
        This organization already has a managed mailbox.
      </p>
    ) : (
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full max-w-md" surface="page">
          <TextFieldInput
            aria-label="Managed mailbox local part"
            chrome="attached"
            onChange={(event) => {
              onLocalPartChange(
                event.currentTarget.value.replaceAll(/[@\s]/gu, "")
              );
            }}
            placeholder="support"
            value={localPart}
          />
          <InputAddon aria-hidden>@</InputAddon>
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
                size="sm"
                variant="attached"
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
            <span className="px-2.5 text-body text-muted-fg">
              {isDomainsPending ? "loading…" : "verified domain"}
            </span>
          )}
        </InputGroup>
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
            <Icon aria-hidden animation="spin" icon={Loading03Icon} />
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
          <p className="inline-flex items-center gap-2 text-body text-success">
            <Icon aria-hidden icon={CheckmarkCircle01Icon} />
            API key created. Store it before leaving this screen.
          </p>
          <Button
            fullWidth
            onClick={() => {
              if (createdApiKey !== null) {
                void navigator.clipboard.writeText(createdApiKey);
                toast.success("Copied API key to clipboard.");
              }
            }}
            size="auto"
            type="button"
            variant="outline"
          >
            <code className="font-mono text-caption break-all">
              {createdApiKey}
            </code>
          </Button>
          <a
            aria-label="Open API reference"
            className={cn(buttonVariants({ variant: "outline" }))}
            href={getApiUrl("/api/openapi")}
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
          <p className="inline-flex items-center gap-2 text-body text-success">
            <Icon aria-hidden icon={CheckmarkCircle01Icon} />
            This organization already has an API key.
          </p>
          <a
            aria-label="Open API reference"
            className={cn(buttonVariants({ variant: "outline" }))}
            href={getApiUrl("/api/openapi")}
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
            <Icon aria-hidden animation="spin" icon={Loading03Icon} />
          ) : (
            <Icon aria-hidden icon={Key02Icon} />
          )}
          Create API key
        </Button>
        <a
          aria-label="Open API reference"
          className={cn(buttonVariants({ variant: "ghost" }))}
          href={getApiUrl("/api/openapi")}
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
        <h2 className="text-body font-medium text-fg">4. Create an API key</h2>
        <p className="mt-1 text-body text-muted-fg">
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
    onError: (error) => {
      toastError(error, {
        boundary: "billing",
        fallback: "Could not start checkout.",
      });
    },
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      await openExternalUrl(result.checkoutUrl);
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
        rethrowClassified(response.error, "Could not create API key.");
      }

      const createdKey = response.data?.key;
      if (createdKey === undefined || createdKey === "") {
        throw new Error("Could not read the created API key.");
      }

      return { key: createdKey, organizationId: requestOrgId };
    },
    mutationKey: ["first-run", "organization-api-key", organizationId],
    onError: (error) => {
      toastError(error, {
        boundary: "onboarding",
        fallback: "Could not create API key.",
      });
    },
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
    <WorkspaceSection
      className="@container mx-auto h-full w-full max-w-5xl lg:max-h-[calc(100dvh-4rem)]"
      layout="surface"
    >
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
                    toastError(error, {
                      boundary: "onboarding",
                      fallback: "Could not create managed mailbox.",
                    });
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
    </WorkspaceSection>
  );
};
