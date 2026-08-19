"use client";

import { CheckmarkCircle02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { GoogleLogo } from "#/components/google-logo";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { orpc } from "#/lib/orpc";

const onboardingRouteApi = getRouteApi("/onboarding");

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

const OnboardingStep = ({
  children,
  description,
  optional = false,
  title,
}: {
  children: React.ReactNode;
  description: string;
  optional?: boolean;
  title: string;
}) => (
  <section className="border-t border-border pt-6">
    <div className="flex items-baseline gap-2">
      <h2 className="text-body-lg font-medium tracking-tight text-fg">
        {title}
      </h2>
      {optional ? (
        <span className="text-micro text-muted-fg">Optional</span>
      ) : null}
    </div>
    <p className="mt-1 text-body-sm text-muted-fg">{description}</p>
    <div className="mt-4">{children}</div>
  </section>
);

export const OnboardingScreen = () => {
  const { gmailLink, returnTo } = onboardingRouteApi.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [hasEditedName, setHasEditedName] = useState(false);

  const { data: state } = useQuery(orpc.onboarding.getState.queryOptions());
  const completeMutation = useMutation({
    ...orpc.onboarding.complete.mutationOptions(),
    onError: () => {
      toast.error("Could not finish setting up your account.");
    },
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: returnTo ?? "/" });
    },
  });

  // The query is the only source for the existing name, so adopt it once and
  // then leave the field alone.
  const resolvedName = hasEditedName ? name : name || (state?.name ?? "");
  const googleEmail = state?.googleEmail ?? null;
  const isGmailConnected =
    state?.hasMailbox === true || gmailLink === "complete";
  const canSubmit = hasText(resolvedName) && termsAccepted;

  const connectGmail = async () => {
    setIsConnectingGmail(true);
    try {
      await openGoogleAccountLink({
        loginHint: googleEmail ?? undefined,
        queryClient,
        returnTo: "/onboarding?gmailLink=complete",
      });
    } catch {
      setIsConnectingGmail(false);
      toast.error("Could not start the Gmail connection.");
    }
  };

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto w-full max-w-xl px-6 py-12 md:py-16">
        <header>
          <h1 className="text-title-md font-medium tracking-tight text-fg">
            Welcome to Quieter
          </h1>
          <p className="mt-2 text-body-sm text-muted-fg">
            A few details, then your mail. You can change any of this later in
            Settings.
          </p>
        </header>

        <div className="mt-10 space-y-8">
          <OnboardingStep
            description="Used on the messages you send and to name your first team."
            title="Your name"
          >
            <Field>
              <FieldLabel htmlFor="onboarding-name">Name</FieldLabel>
              <Input
                autoComplete="name"
                id="onboarding-name"
                onChange={(event) => {
                  setHasEditedName(true);
                  setName(event.target.value);
                }}
                placeholder="Ada Lovelace"
                value={resolvedName}
              />
            </Field>
          </OnboardingStep>

          <OnboardingStep
            description="Teams hold your mailboxes and billing. Yours is named after you unless you choose something else."
            optional
            title="Team name"
          >
            <Field>
              <FieldLabel htmlFor="onboarding-team">Team</FieldLabel>
              <Input
                id="onboarding-team"
                onChange={(event) => {
                  setTeamName(event.target.value);
                }}
                placeholder={
                  hasText(resolvedName) ? `${resolvedName}'s team` : "My team"
                }
                value={teamName}
              />
            </Field>
          </OnboardingStep>

          <OnboardingStep
            description="Connect a Gmail account, or set up a domain for a shared inbox. You can also do this later."
            optional
            title="Your mail"
          >
            {isGmailConnected ? (
              <p className="flex items-center gap-2 text-body-sm text-fg">
                <HugeiconsIcon
                  aria-hidden
                  className="size-4 text-success"
                  icon={CheckmarkCircle02Icon}
                />
                Mailbox connected.
              </p>
            ) : (
              <div className="space-y-2">
                <Button
                  className="w-full justify-center gap-3"
                  disabled={isConnectingGmail}
                  onClick={() => void connectGmail()}
                  type="button"
                  variant="outline"
                >
                  <GoogleLogo className="size-4" />
                  {hasText(googleEmail)
                    ? `Connect ${googleEmail}`
                    : "Connect a Gmail account"}
                </Button>
                {hasText(googleEmail) ? (
                  <p className="text-micro text-muted-fg">
                    Signing in only proved who you are. Google asks separately
                    before Quieter can read this mailbox.
                  </p>
                ) : null}
                <Link
                  className="block text-body-sm text-muted-fg underline hover:text-fg"
                  search={{ tab: "organization" }}
                  to="/settings"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className="mr-1 inline size-3.5"
                    icon={Mail01Icon}
                  />
                  Set up a domain instead
                </Link>
              </div>
            )}
          </OnboardingStep>

          <section className="border-t border-border pt-6">
            <label className="flex items-start gap-3 text-body-sm text-muted-fg">
              <Checkbox
                checked={termsAccepted}
                className="mt-0.5"
                onCheckedChange={setTermsAccepted}
              >
                <CheckboxIndicator />
              </Checkbox>
              <span>
                I agree to the{" "}
                <Link className="text-fg underline" target="_blank" to="/terms">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  className="text-fg underline"
                  target="_blank"
                  to="/privacy"
                >
                  Privacy Policy
                </Link>
                .
              </span>
            </label>

            <Button
              className={cn("mt-6 w-full justify-center")}
              disabled={!canSubmit || completeMutation.isPending}
              onClick={() => {
                completeMutation.mutate({
                  acceptedTerms: true,
                  name: resolvedName.trim(),
                  teamName: hasText(teamName) ? teamName.trim() : undefined,
                });
              }}
              type="button"
            >
              {completeMutation.isPending ? "Setting up…" : "Continue"}
            </Button>
            <p className="mt-3 text-center text-micro text-muted-fg">
              Your account is not active until you accept.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
};
