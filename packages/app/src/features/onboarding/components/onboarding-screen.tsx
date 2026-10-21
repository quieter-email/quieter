"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Globe02Icon,
  Key02Icon,
  Loading03Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AuthLayout } from "@quieter/app/components/auth-layout";
import { GoogleLogo } from "@quieter/app/components/google-logo";
import { getAppFlyInMotion } from "@quieter/app/features/motion/app-motion";
import {
  isOnboardingIntentId,
  loadStoredOnboardingIntents,
  ONBOARDING_INTENT_OPTIONS,
  storeOnboardingIntents,
} from "@quieter/app/features/onboarding/domain/onboarding-intents";
import type { OnboardingIntentId } from "@quieter/app/features/onboarding/domain/onboarding-intents";
import { partitionMailDomains } from "@quieter/app/features/onboarding/domain/onboarding-playbooks";
import type { OnboardingMailDomain } from "@quieter/app/features/onboarding/domain/onboarding-playbooks";
import { RegisterDomainDialog } from "@quieter/app/features/settings/components/organization-settings/register-domain-dialog";
import {
  getTeamBilling,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "@quieter/app/features/settings/domain/billing";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { openGoogleAccountLink } from "@quieter/app/lib/google-account-link";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { getApiUrl, openExternalUrl } from "@quieter/app/runtime";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { FlowProgress } from "@quieter/ui/progress";
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
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const onboardingRouteApi = getRouteApi("/_app/onboarding");

type OnboardingState = NonNullable<RouterOutputs["onboarding"]["getState"]>;

const ConnectedAddressList = ({
  mailboxes,
}: {
  mailboxes: { emailAddress: string; id: string }[];
}) => (
  <ul className="space-y-1">
    {mailboxes.map((mailbox) => (
      <li
        className="flex min-w-0 items-center gap-2 text-body-sm text-fg"
        key={mailbox.id}
      >
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 shrink-0 text-success"
          icon={CheckmarkCircle02Icon}
        />
        <span className="min-w-0 break-all">{mailbox.emailAddress}</span>
      </li>
    ))}
  </ul>
);

const PlaybookCard = ({
  children,
  icon,
  requirement,
  state,
  title,
}: {
  children: React.ReactNode;
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
  requirement?: string;
  state: "done" | "todo";
  title: string;
}) => (
  <section
    className={cn("rounded-lg border p-4", {
      "border-border": state !== "done",
      "border-success/40 bg-success/5": state === "done",
    })}
  >
    <div className="flex items-center gap-2">
      <HugeiconsIcon
        aria-hidden
        className={cn("size-4 shrink-0", {
          "text-muted-fg": state !== "done",
          "text-success": state === "done",
        })}
        icon={state === "done" ? CheckmarkCircle02Icon : icon}
      />
      <h3 className="text-body font-medium tracking-tight text-fg">{title}</h3>
      {requirement === undefined ? null : (
        <span className="rounded-full border border-border px-2 py-0.5 text-micro text-muted-fg">
          {requirement}
        </span>
      )}
    </div>
    <div className="mt-3">{children}</div>
  </section>
);

const TermsConsent = ({
  accepted,
  onAcceptedChange,
}: {
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
}) => (
  <label
    className="flex items-start gap-3 text-body-sm text-muted-fg"
    htmlFor="onboarding-terms"
  >
    <Checkbox
      checked={accepted}
      className="mt-0.5"
      id="onboarding-terms"
      onCheckedChange={onAcceptedChange}
    >
      <CheckboxIndicator />
    </Checkbox>
    <span>
      I agree to the{" "}
      <Link className="text-fg underline" target="_blank" to="/terms">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link className="text-fg underline" target="_blank" to="/privacy">
        Privacy Policy
      </Link>
      .
    </span>
  </label>
);

const PlaybookBillingAction = ({
  fixedMode,
  hasManagedBilling,
  isUpgrading,
  onUpgrade,
  organizationId,
}: {
  fixedMode: "send_and_receive" | "send_only";
  hasManagedBilling: boolean;
  isUpgrading: boolean;
  onUpgrade: () => void;
  organizationId: string | null;
}) => {
  if (organizationId === null) {
    return (
      <p className="text-micro text-muted-fg">
        Finish setup first, then add a domain from Settings.
      </p>
    );
  }

  if (!hasManagedBilling) {
    return (
      <Button
        disabled={isUpgrading}
        onClick={onUpgrade}
        pending={isUpgrading}
        pendingLabel="Opening checkout…"
        size="sm"
        type="button"
        variant="outline"
      >
        Upgrade to {BILLING_FEATURES.organizationDomains.requirementLabel}
      </Button>
    );
  }

  return (
    <RegisterDomainDialog fixedMode={fixedMode} organizationId={organizationId}>
      <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
      Add a domain
    </RegisterDomainDialog>
  );
};

const DomainStatusNote = ({ count }: { count: number }) => (
  <p className="flex items-center gap-2 text-body-sm text-muted-fg">
    <HugeiconsIcon
      aria-hidden
      className="size-3.5 animate-spin text-muted-fg"
      icon={Loading03Icon}
    />
    DNS setup in progress for {count} {count === 1 ? "domain" : "domains"}.
    <Link
      className="text-fg underline hover:text-fg"
      search={{ organizationView: "domains", tab: "organization" }}
      to="/settings"
    >
      Continue verification
    </Link>
  </p>
);

const GmailPlaybook = ({
  gmailMailboxes,
  googleEmail,
  isConnecting,
  onConnect,
}: {
  gmailMailboxes: OnboardingState["gmailMailboxes"];
  googleEmail: string | null;
  isConnecting: boolean;
  onConnect: () => void;
}) => {
  const isConnected = gmailMailboxes.length > 0;

  const body = () => {
    if (isConnected) {
      return (
        <div className="space-y-2">
          <ConnectedAddressList mailboxes={gmailMailboxes} />
          <Button
            disabled={isConnecting}
            fullWidth
            onClick={onConnect}
            size="sm"
            type="button"
            variant="outline"
          >
            <GoogleLogo className="size-4" />
            Add another Gmail mailbox
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <p className="text-body-sm text-muted-fg">
          Connect a Gmail account to read and send from it.
        </p>
        <Button
          disabled={isConnecting}
          fullWidth
          onClick={onConnect}
          size="sm"
          type="button"
          variant="outline"
        >
          <GoogleLogo className="size-4" />
          <span className="min-w-0 truncate">
            {googleEmail?.trim() ? `Add ${googleEmail}` : "Add a Gmail mailbox"}
          </span>
        </Button>
        {googleEmail?.trim() ? (
          <p className="text-micro text-muted-fg">
            Signing in only proved who you are. Google asks separately before
            Quieter can read this mailbox.
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <PlaybookCard
      icon={Mail01Icon}
      state={isConnected ? "done" : "todo"}
      title="Gmail"
    >
      {body()}
    </PlaybookCard>
  );
};

const SendingPlaybook = ({
  domains,
  hasManagedBilling,
  isUpgrading,
  onUpgrade,
  organizationId,
}: {
  domains: OnboardingMailDomain[];
  hasManagedBilling: boolean;
  isUpgrading: boolean;
  onUpgrade: () => void;
  organizationId: string | null;
}) => {
  const { pendingSending, verifiedSending } = partitionMailDomains(domains);
  const isDone = verifiedSending.length > 0;

  const body = () => {
    if (isDone) {
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {verifiedSending.map((domain) => (
              <span
                className="rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-caption text-success"
                key={domain.id}
              >
                {domain.domain}
              </span>
            ))}
          </div>
          <p className="text-body-sm text-muted-fg">
            Next steps to start sending:
          </p>
          <ul className="space-y-1 text-body-sm">
            <li>
              <Link
                className="text-fg underline hover:text-fg"
                search={{ organizationView: "api-keys", tab: "organization" }}
                to="/settings"
              >
                Create an organization API key
              </Link>
            </li>
            <li>
              <a
                className="text-fg underline hover:text-fg"
                href={getApiUrl("/api/openapi")}
                rel="noreferrer"
                target="_blank"
              >
                Open the API reference
              </a>
            </li>
          </ul>
        </div>
      );
    }

    if (pendingSending.length > 0) {
      return <DomainStatusNote count={pendingSending.length} />;
    }

    return (
      <div className="space-y-2">
        <p className="text-body-sm text-muted-fg">
          Verify a domain to authorize sending from it.
        </p>
        <PlaybookBillingAction
          fixedMode="send_only"
          hasManagedBilling={hasManagedBilling}
          isUpgrading={isUpgrading}
          onUpgrade={onUpgrade}
          organizationId={organizationId}
        />
      </div>
    );
  };

  return (
    <PlaybookCard
      icon={Key02Icon}
      requirement={BILLING_FEATURES.organizationDomains.requirementLabel}
      state={isDone ? "done" : "todo"}
      title="API and MCP sending"
    >
      {body()}
    </PlaybookCard>
  );
};

const CustomInboxPlaybook = ({
  domains,
  hasManagedBilling,
  isUpgrading,
  managedMailboxes,
  onCreateMailbox,
  onUpgrade,
  organizationId,
  isCreating,
}: {
  domains: OnboardingMailDomain[];
  hasManagedBilling: boolean;
  isUpgrading: boolean;
  managedMailboxes: OnboardingState["managedMailboxes"];
  onCreateMailbox: (emailAddress: string) => void;
  onUpgrade: () => void;
  organizationId: string | null;
  isCreating: boolean;
}) => {
  const { pendingReceiving, verifiedReceiving } = partitionMailDomains(domains);
  const isDone = managedMailboxes.length > 0;
  const [localPart, setLocalPart] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string>();
  const domain = selectedDomain ?? verifiedReceiving[0]?.domain ?? "";
  const trimmedLocalPart = localPart.trim();

  const body = () => {
    if (verifiedReceiving.length > 0) {
      return (
        <div className="space-y-3">
          {managedMailboxes.length > 0 ? (
            <ConnectedAddressList mailboxes={managedMailboxes} />
          ) : null}
          <div className="flex h-8 w-full max-w-md items-center rounded-md border border-border bg-bg shadow-sm transition-colors squircle">
            <TextFieldInput
              aria-label="Mailbox address"
              chrome="ghost"
              // oxlint-disable-next-line shadcn/no-restyle -- Local-part input fills its row height.
              className="h-full min-w-0 flex-1 pr-1"
              onChange={(event) => {
                setLocalPart(
                  event.currentTarget.value.replaceAll(/[@\s]/gu, "")
                );
              }}
              placeholder="support"
              value={localPart}
            />
            <span aria-hidden className="text-body text-muted-fg select-none">
              @
            </span>
            <Select
              items={verifiedReceiving.map((item) => ({
                label: item.domain,
                value: item.domain,
              }))}
              onValueChange={(value) => {
                setSelectedDomain(value ?? undefined);
              }}
              value={domain}
            >
              <SelectTrigger
                aria-label="Mailbox domain"
                size="sm"
                variant="attached"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {verifiedReceiving.map((item) => (
                  <SelectItem key={item.id} value={item.domain}>
                    {item.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={trimmedLocalPart === "" || domain === "" || isCreating}
            onClick={() => {
              onCreateMailbox(`${trimmedLocalPart}@${domain}`);
            }}
            size="sm"
            type="button"
          >
            Create a mailbox
          </Button>
        </div>
      );
    }

    if (pendingReceiving.length > 0) {
      return <DomainStatusNote count={pendingReceiving.length} />;
    }

    return (
      <div className="space-y-2">
        <p className="text-body-sm text-muted-fg">
          Verify a domain that can receive mail, then add shared inboxes on it.
        </p>
        <PlaybookBillingAction
          fixedMode="send_and_receive"
          hasManagedBilling={hasManagedBilling}
          isUpgrading={isUpgrading}
          onUpgrade={onUpgrade}
          organizationId={organizationId}
        />
      </div>
    );
  };

  return (
    <PlaybookCard
      icon={Globe02Icon}
      requirement={BILLING_FEATURES.organizationDomains.requirementLabel}
      state={isDone ? "done" : "todo"}
      title="Custom inboxes"
    >
      {body()}
    </PlaybookCard>
  );
};

export const OnboardingScreen = () => {
  const {
    gmailLink,
    intents: intentsParam,
    returnTo,
    step: stepParam,
  } = onboardingRouteApi.useSearch();
  const navigate = useNavigate();
  const routeNavigate = onboardingRouteApi.useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const reducedMotion = useReducedMotion();
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signOut();
      if (response.error) {
        throw new Error(response.error.message ?? "Could not sign out.");
      }
      return response;
    },
    mutationKey: ["auth", "sign-out"],
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/home" });
    },
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const step: 1 | 2 = stepParam === 2 ? 2 : 1;
  const selectedIntents = useMemo(
    () =>
      (intentsParam ?? "")
        .split(",")
        .filter((value): value is OnboardingIntentId =>
          isOnboardingIntentId(value)
        ),
    [intentsParam]
  );
  const setSelectedIntents = useCallback(
    (next: OnboardingIntentId[]) => {
      void routeNavigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          intents: next.length > 0 ? next.join(",") : undefined,
        }),
        to: ".",
      });
    },
    [routeNavigate]
  );
  const setStep = (next: 1 | 2) => {
    void routeNavigate({
      replace: true,
      search: (previous) => ({ ...previous, step: next }),
      to: ".",
    });
  };
  const hydratedEmailRef = useRef<string | null>(null);
  // Captured once so the ugly encoded value can leave the address bar.
  const returnToRef = useRef<string | null>(null);
  const autoStartedGmailRef = useRef(false);

  const { data: state } = useQuery(orpc.onboarding.getState.queryOptions());
  const completeMutation = useMutation({
    ...orpc.onboarding.complete.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "onboarding",
        fallback: "Could not finish setting up your account.",
      });
    },
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: returnToRef.current ?? "/" });
    },
  });
  const createMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailbox.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "onboarding",
        fallback: "Could not create the mailbox.",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.onboarding.getState.key(),
      });
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
      toast.success("Mailbox created.");
    },
  });

  const email = state?.email;
  useEffect(() => {
    if (email === undefined || hydratedEmailRef.current === email) {
      return;
    }
    hydratedEmailRef.current = email;
    if (intentsParam !== undefined) {
      return;
    }
    const stored = loadStoredOnboardingIntents(globalThis.localStorage, email);
    if (stored.length > 0) {
      setSelectedIntents(stored);
    }
  }, [email, intentsParam, setSelectedIntents]);

  useEffect(() => {
    if (returnTo === undefined) {
      return;
    }
    returnToRef.current = returnTo;
    void routeNavigate({
      replace: true,
      search: (previous) => ({ ...previous, returnTo: undefined }),
      to: ".",
    });
  }, [returnTo, routeNavigate]);

  useEffect(() => {
    if (email === undefined || hydratedEmailRef.current !== email) {
      return;
    }
    storeOnboardingIntents(globalThis.localStorage, email, selectedIntents);
  }, [email, selectedIntents]);

  const googleEmail = state?.googleEmail ?? null;
  const organizationId = state?.organizationId ?? null;
  const { data: billingOverview } = useQuery(userBillingQueryOptions());
  const hasManagedBilling =
    organizationId !== null &&
    getTeamBilling(billingOverview, organizationId)?.hasAccess === true;
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
  const startManagedUpgrade = () => {
    if (organizationId === null) {
      return;
    }
    checkoutMutation.mutate({ organizationId, product: "managed" });
  };
  const isGmailConnected =
    (state?.gmailMailboxes.length ?? 0) > 0 || gmailLink === "complete";

  const connectGmail = useCallback(async () => {
    setIsConnectingGmail(true);
    try {
      await openGoogleAccountLink({
        loginHint: googleEmail ?? undefined,
        queryClient,
        returnTo: "/onboarding?gmailLink=complete",
      });
    } catch (error) {
      setIsConnectingGmail(false);
      toastError(error, {
        boundary: "gmail-connect",
        fallback: "Could not start the Gmail connection.",
      });
    }
  }, [googleEmail, queryClient]);

  useEffect(() => {
    if (
      gmailLink !== "start" ||
      autoStartedGmailRef.current ||
      isGmailConnected ||
      organizationId === null
    ) {
      return;
    }
    autoStartedGmailRef.current = true;
    const run = async () => {
      await navigate({
        replace: true,
        search: (previous) => ({ ...previous, gmailLink: undefined }),
        to: "/onboarding",
      });
      await connectGmail();
    };
    void run();
  }, [connectGmail, gmailLink, isGmailConnected, navigate, organizationId]);

  const toggleIntent = (intent: OnboardingIntentId) => {
    setSelectedIntents(
      selectedIntents.includes(intent)
        ? selectedIntents.filter((value) => value !== intent)
        : [...selectedIntents, intent]
    );
  };

  const canContinue = name.trim().length > 0;
  const canFinish =
    state !== null &&
    state !== undefined &&
    canContinue &&
    (state.hasAcceptedTerms || termsAccepted) &&
    !completeMutation.isPending;
  const hasAnySetup =
    isGmailConnected ||
    (state !== null &&
      state !== undefined &&
      (state.domains.length > 0 || state.managedMailboxes.length > 0));

  const renderIntentPlaybooks = () =>
    ONBOARDING_INTENT_OPTIONS.filter((option) =>
      selectedIntents.includes(option.id)
    ).map((option) => {
      if (option.id === "gmail") {
        return (
          <GmailPlaybook
            gmailMailboxes={state?.gmailMailboxes ?? []}
            googleEmail={googleEmail}
            isConnecting={isConnectingGmail}
            key={option.id}
            onConnect={() => {
              void connectGmail();
            }}
          />
        );
      }
      if (option.id === "api") {
        return (
          <SendingPlaybook
            domains={state?.domains ?? []}
            hasManagedBilling={hasManagedBilling}
            isUpgrading={checkoutMutation.isPending}
            key={option.id}
            onUpgrade={startManagedUpgrade}
            organizationId={organizationId}
          />
        );
      }
      return (
        <CustomInboxPlaybook
          domains={state?.domains ?? []}
          hasManagedBilling={hasManagedBilling}
          isCreating={createMailboxMutation.isPending}
          isUpgrading={checkoutMutation.isPending}
          key={option.id}
          managedMailboxes={state?.managedMailboxes ?? []}
          onCreateMailbox={(emailAddress) => {
            if (organizationId !== null) {
              createMailboxMutation.mutate({ emailAddress, organizationId });
            }
          }}
          onUpgrade={startManagedUpgrade}
          organizationId={organizationId}
        />
      );
    });

  const activeStep = step === 1 ? "onboarding-intents" : "onboarding-playbooks";
  const isSingleStep = selectedIntents.length === 0;
  const steps = isSingleStep
    ? (["About you"] as const)
    : (["About you", "Setup"] as const);

  return (
    <AuthLayout
      title={step === 1 ? "Welcome to Quieter" : "Set up what you need"}
    >
      <div className="mt-4 flex items-center justify-center gap-3">
        <span className="text-caption text-muted-fg">
          Step {step} of {steps.length}
        </span>
        <FlowProgress
          label="Onboarding progress"
          max={steps.length}
          value={step}
        />
      </div>
      <LazyMotion features={domAnimation}>
        <m.div
          key={activeStep}
          {...getAppFlyInMotion({ animate: true, reducedMotion })}
        >
          {step === 1 ? (
            <div>
              <m.div
                className="mt-6 space-y-4"
                {...getAppFlyInMotion({
                  animate: true,
                  index: 1,
                  reducedMotion,
                })}
              >
                <Field>
                  <FieldLabel htmlFor="onboarding-name">Name</FieldLabel>
                  <Input
                    autoComplete="name"
                    id="onboarding-name"
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    placeholder="Your name"
                    value={name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="onboarding-team">
                    Team{" "}
                    <span className="text-micro font-normal text-muted-fg">
                      Optional
                    </span>
                  </FieldLabel>
                  <Input
                    id="onboarding-team"
                    onChange={(event) => {
                      setTeamName(event.target.value);
                    }}
                    placeholder={
                      name.trim() ? `${name.trim()}'s team` : "Your team"
                    }
                    value={teamName}
                  />
                </Field>
              </m.div>

              <m.fieldset
                className="mt-6"
                {...getAppFlyInMotion({
                  animate: true,
                  index: 2,
                  reducedMotion,
                })}
              >
                <legend className="w-full text-center text-body font-medium text-fg">
                  What brings you here?
                </legend>
                <p className="mt-1 text-center text-body-sm text-muted-fg">
                  Choose any, or skip for now.
                </p>
                <div className="mt-4 space-y-1">
                  {ONBOARDING_INTENT_OPTIONS.map((option) => {
                    const checked = selectedIntents.includes(option.id);
                    const inputId = `onboarding-intent-${option.id}`;
                    return (
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 py-1.5 text-body transition-colors",
                          {
                            "text-fg": checked,
                            "text-muted-fg hover:text-fg": !checked,
                          }
                        )}
                        htmlFor={inputId}
                        key={option.id}
                      >
                        <Checkbox
                          checked={checked}
                          id={inputId}
                          onCheckedChange={() => {
                            toggleIntent(option.id);
                          }}
                        >
                          <CheckboxIndicator />
                        </Checkbox>
                        <span className="min-w-0 flex-1">{option.title}</span>
                        {"requiresManagedBilling" in option ? (
                          <span className="shrink-0 text-micro text-muted-fg">
                            {
                              BILLING_FEATURES.organizationDomains
                                .requirementLabel
                            }
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </m.fieldset>

              <m.div
                className="mt-6 space-y-4"
                {...getAppFlyInMotion({
                  animate: true,
                  index: 3,
                  reducedMotion,
                })}
              >
                {isSingleStep && state?.hasAcceptedTerms === false ? (
                  <TermsConsent
                    accepted={termsAccepted}
                    onAcceptedChange={setTermsAccepted}
                  />
                ) : null}
                <div>
                  {isSingleStep ? (
                    <Button
                      disabled={!canFinish}
                      fullWidth
                      onClick={() => {
                        completeMutation.mutate({
                          acceptedTerms: true,
                          name: name.trim(),
                          teamName: teamName.trim() || undefined,
                        });
                      }}
                      pending={completeMutation.isPending}
                      pendingLabel="Setting up…"
                    >
                      Finish
                    </Button>
                  ) : (
                    <Button
                      disabled={!canContinue}
                      fullWidth
                      onClick={() => {
                        setStep(2);
                      }}
                    >
                      Continue
                      <HugeiconsIcon aria-hidden icon={ArrowRight01Icon} />
                    </Button>
                  )}
                </div>
              </m.div>
            </div>
          ) : (
            <div>
              <div className="mt-6 space-y-4">
                {selectedIntents.length > 0 ? (
                  <>{renderIntentPlaybooks()}</>
                ) : (
                  <p className="text-center text-body-sm text-muted-fg">
                    Nothing selected yet. Finish now, or go back and pick what
                    you came for.
                  </p>
                )}
              </div>

              <div className="mt-6 space-y-4">
                {state?.hasAcceptedTerms === false ? (
                  <TermsConsent
                    accepted={termsAccepted}
                    onAcceptedChange={setTermsAccepted}
                  />
                ) : null}

                {hasAnySetup ? null : (
                  <p className="text-center text-micro text-muted-fg">
                    You can set up as many mailboxes as you want later on.
                  </p>
                )}

                <div>
                  <Button
                    disabled={!canFinish}
                    fullWidth
                    onClick={() => {
                      completeMutation.mutate({
                        acceptedTerms: true,
                        name: name.trim(),
                        teamName: teamName.trim() || undefined,
                      });
                    }}
                    pending={completeMutation.isPending}
                    pendingLabel="Setting up…"
                  >
                    Finish setup
                  </Button>
                </div>
                <div className="flex justify-center">
                  <Button
                    onClick={() => {
                      setStep(1);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
                    {steps[0]}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </m.div>
      </LazyMotion>
      <div className="mt-4 flex justify-center">
        <Button
          disabled={signOutMutation.isPending}
          onClick={() => {
            signOutMutation.mutate(undefined, {
              onError: (error) => {
                toastError(error, {
                  boundary: "onboarding-sign-out",
                  fallback: "Could not sign out.",
                });
              },
            });
          }}
          size="sm"
          variant="ghost"
        >
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
};
