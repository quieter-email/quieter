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
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@quieter/ui/progress";
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
import { m, useReducedMotion } from "motion/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { GoogleLogo } from "#/components/google-logo";
import { GuidedFlow } from "#/features/guided-flow/components/guided-flow";
import { getAppFlyInMotion } from "#/features/motion/app-motion";
import {
  loadStoredOnboardingIntents,
  ONBOARDING_INTENT_OPTIONS,
  storeOnboardingIntents,
} from "#/features/onboarding/domain/onboarding-intents";
import type { OnboardingIntentId } from "#/features/onboarding/domain/onboarding-intents";
import { partitionMailDomains } from "#/features/onboarding/domain/onboarding-playbooks";
import type { OnboardingMailDomain } from "#/features/onboarding/domain/onboarding-playbooks";
import { RegisterDomainDialog } from "#/features/settings/components/organization-settings/register-domain-dialog";
import { authClient } from "#/lib/auth";
import { toastError } from "#/lib/error-toast";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

const onboardingRouteApi = getRouteApi("/onboarding");

// Deferred: the welcome should paint before the shader compiles.
const AtmosphericBackground = lazy(
  async () =>
    await import("#/components/atmospheric-background").then(
      ({ AtmosphericBackground: Component }) => ({ default: Component })
    )
);

type OnboardingState = NonNullable<RouterOutputs["onboarding"]["getState"]>;

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

const ConnectedAddressList = ({
  mailboxes,
}: {
  mailboxes: { emailAddress: string; id: string }[];
}) => (
  <ul className="space-y-1">
    {mailboxes.map((mailbox) => (
      <li
        className="flex items-center gap-2 text-body-sm text-fg"
        key={mailbox.id}
      >
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 text-success"
          icon={CheckmarkCircle02Icon}
        />
        {mailbox.emailAddress}
      </li>
    ))}
  </ul>
);

const PlaybookCard = ({
  children,
  icon,
  state,
  title,
}: {
  children: React.ReactNode;
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
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
          onClick={onConnect}
          size="sm"
          type="button"
          variant="outline"
        >
          <GoogleLogo className="size-4" />
          {hasText(googleEmail) ? `Add ${googleEmail}` : "Add a Gmail mailbox"}
        </Button>
        {hasText(googleEmail) ? (
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
  organizationId,
}: {
  domains: OnboardingMailDomain[];
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
                href="/api/openapi"
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
        {organizationId === null ? null : (
          <RegisterDomainDialog
            fixedMode="send_only"
            organizationId={organizationId}
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
            Add a domain
          </RegisterDomainDialog>
        )}
      </div>
    );
  };

  return (
    <PlaybookCard
      icon={Key02Icon}
      state={isDone ? "done" : "todo"}
      title="API and MCP sending"
    >
      {body()}
    </PlaybookCard>
  );
};

const CustomInboxPlaybook = ({
  domains,
  managedMailboxes,
  onCreateMailbox,
  organizationId,
  isCreating,
}: {
  domains: OnboardingMailDomain[];
  managedMailboxes: OnboardingState["managedMailboxes"];
  onCreateMailbox: (emailAddress: string) => void;
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
          <div className="squircle flex h-9 w-full max-w-md items-center rounded-md border border-border bg-bg shadow-sm transition-colors">
            <TextFieldInput
              aria-label="Mailbox address"
              chrome="ghost"
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
                className="h-full rounded-l-none pr-2.5 pl-1.5 shadow-none active:scale-100"
                size="sm"
                variant="ghost"
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
        {organizationId === null ? null : (
          <RegisterDomainDialog
            fixedMode="send_and_receive"
            organizationId={organizationId}
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
            Add a domain
          </RegisterDomainDialog>
        )}
      </div>
    );
  };

  return (
    <PlaybookCard
      icon={Globe02Icon}
      state={isDone ? "done" : "todo"}
      title="Custom inboxes"
    >
      {body()}
    </PlaybookCard>
  );
};

export const OnboardingScreen = () => {
  const { gmailLink, returnTo } = onboardingRouteApi.useSearch();
  const navigate = useNavigate();
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
  const [step, setStep] = useState<1 | 2>(1);
  const [direction, setDirection] = useState<"back" | "forward">("forward");
  const [selectedIntents, setSelectedIntents] = useState<OnboardingIntentId[]>(
    []
  );
  const hydratedEmailRef = useRef<string | null>(null);
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
      await navigate({ to: returnTo ?? "/" });
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
    setSelectedIntents(
      loadStoredOnboardingIntents(globalThis.localStorage, email)
    );
  }, [email]);

  useEffect(() => {
    if (email === undefined || hydratedEmailRef.current !== email) {
      return;
    }
    storeOnboardingIntents(globalThis.localStorage, email, selectedIntents);
  }, [email, selectedIntents]);

  const googleEmail = state?.googleEmail ?? null;
  const organizationId = state?.organizationId ?? null;
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
    setSelectedIntents((previous) =>
      previous.includes(intent)
        ? previous.filter((value) => value !== intent)
        : [...previous, intent]
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
            key={option.id}
            organizationId={organizationId}
          />
        );
      }
      return (
        <CustomInboxPlaybook
          domains={state?.domains ?? []}
          isCreating={createMailboxMutation.isPending}
          key={option.id}
          managedMailboxes={state?.managedMailboxes ?? []}
          onCreateMailbox={(emailAddress) => {
            if (organizationId !== null) {
              createMailboxMutation.mutate({ emailAddress, organizationId });
            }
          }}
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
    <GuidedFlow
      backdrop={
        <Suspense fallback={null}>
          <AtmosphericBackground
            className="-z-10"
            fadeBottom="canvas"
            fadeTop="canvas"
            grain={0.4}
            intensity={0.5}
          />
        </Suspense>
      }
      activeStep={activeStep}
      ariaLabel="Onboarding"
      direction={direction}
      headerEnd={
        <div className="flex items-center gap-3">
          <span className="text-caption text-muted-fg">
            <span className="hidden sm:inline">Step </span>
            {step} / {steps.length}
          </span>
          <Progress
            aria-label="Onboarding progress"
            className="hidden w-16 gap-0 sm:grid"
            max={steps.length}
            value={step}
          >
            <ProgressTrack className="h-1 bg-control-hover">
              <ProgressIndicator className="bg-fg" />
            </ProgressTrack>
          </Progress>
        </div>
      }
      headerStart={
        <Button
          className="-ml-2 text-muted-fg hover:text-fg"
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
          <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
          Sign out
        </Button>
      }
      previous={
        step === 2 ? (
          <Button
            className="text-muted-fg hover:text-fg"
            onClick={() => {
              setDirection("back");
              setStep(1);
            }}
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
            {steps[0]}
          </Button>
        ) : null
      }
    >
      {step === 1 ? (
        <div className="relative mx-auto max-w-xl">
          <m.header
            className="relative text-center"
            {...getAppFlyInMotion({ animate: true, index: 0, reducedMotion })}
          >
            <h1 className="font-serif text-title-lg leading-[1.32] font-normal tracking-[-0.014em] text-balance text-fg">
              Welcome to Quieter
            </h1>
          </m.header>

          <m.div
            className="mt-8 space-y-4"
            {...getAppFlyInMotion({ animate: true, index: 1, reducedMotion })}
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
            className="mt-10"
            {...getAppFlyInMotion({ animate: true, index: 2, reducedMotion })}
          >
            <legend className="text-body font-medium text-fg">
              What are you planning to do with Quieter?
            </legend>
            <p className="mt-1 text-body/6 text-muted-fg">
              Pick everything that applies. You can skip and decide later.
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
                    {option.title}
                  </label>
                );
              })}
            </div>
          </m.fieldset>

          <m.div
            className="mt-10 space-y-4"
            {...getAppFlyInMotion({ animate: true, index: 3, reducedMotion })}
          >
            {isSingleStep && state?.hasAcceptedTerms === false ? (
              <TermsConsent
                accepted={termsAccepted}
                onAcceptedChange={setTermsAccepted}
              />
            ) : null}
            <div className="flex justify-end">
              {isSingleStep ? (
                <Button
                  disabled={!canFinish}
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
                  onClick={() => {
                    setDirection("forward");
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
        <div className="mx-auto max-w-xl">
          <header>
            <h1 className="font-serif text-title-md leading-[1.32] font-normal tracking-[-0.014em] text-balance text-fg">
              Set up what you need
            </h1>
          </header>

          <div className="mt-8 space-y-4">
            {selectedIntents.length > 0 ? (
              <>{renderIntentPlaybooks()}</>
            ) : (
              <p className="rounded-lg border border-border p-4 text-body-sm text-muted-fg">
                Nothing selected yet. Finish now, or go back and pick what you
                came for.
              </p>
            )}
          </div>

          <div className="mt-10 space-y-4">
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

            <div className="flex justify-end">
              <Button
                disabled={!canFinish}
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
          </div>
        </div>
      )}
    </GuidedFlow>
  );
};
