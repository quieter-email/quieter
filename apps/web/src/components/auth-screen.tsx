"use client";

import { Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { FieldLabel } from "@quieter/ui/field";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { domAnimation, LazyMotion, m } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { AuthVisual } from "#/components/auth-visual";
import { GoogleLogo } from "#/components/google-logo";
import { setDemoModeEnabled } from "#/features/settings/domain/demo-mode-setting";
import { setManagedDemoModeEnabled } from "#/features/settings/domain/managed-demo-mode-setting";
import { authClient } from "#/lib/auth";
import {
  isPreviewPersonasAvailable,
  setPreviewPersona,
} from "#/lib/preview-personas";
import type { PreviewPersona } from "#/lib/preview-personas";
import { queryPersister } from "#/lib/query-persister";
import { setTermsAcceptanceCookie } from "#/lib/terms-acceptance";

const authRouteApi = getRouteApi("/auth");
const AUTHENTICATION_ERROR_MESSAGE =
  "Unable to authenticate. Please check your credentials or try again.";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

const normalizeAuthReturnTo = (returnTo?: string) => {
  if (!hasText(returnTo)) {
    return "/";
  }

  try {
    const url = new URL(returnTo, "https://quieter.local");
    if (url.origin !== "https://quieter.local") {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
};

type AuthNavigate = ReturnType<(typeof authRouteApi)["useNavigate"]>;

type AuthFormValues = {
  email: string;
};

const previewPersonaOptions: { label: string; persona: PreviewPersona }[] = [
  { label: "User with Gmail", persona: "gmail" },
  { label: "User with managed mail", persona: "managed" },
  { label: "Onboarding user", persona: "empty" },
];

const AuthLastUsedHint = () => (
  <LazyMotion features={domAnimation}>
    <span
      aria-hidden
      className="squircle pointer-events-none absolute -inset-e-2.5 -top-2.5 isolate overflow-hidden rounded-md p-px shadow-sm *:pointer-events-none"
    >
      <m.span
        animate={{ rotate: 360 }}
        aria-hidden
        className="absolute top-1/2 left-1/2 aspect-square w-[300%] -translate-1/2"
        style={{
          background:
            "conic-gradient(from 0deg, var(--border) 0deg, var(--border) 270deg, color-mix(in oklch, var(--primary) 100%, var(--border)) 325deg, var(--border) 360deg)",
        }}
        transition={{ duration: 5, ease: "linear", repeat: Infinity }}
      />
      <span className="squircle relative block rounded-[inherit] bg-bg px-2 py-1 text-micro font-medium tracking-wide text-muted-fg">
        Last used
      </span>
    </span>
  </LazyMotion>
);

const AuthCredentials = ({
  navigate,
  returnTo,
}: {
  navigate: AuthNavigate;
  returnTo?: string;
}) => {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<{
    google?: string;
    passkey?: string;
    terms?: string;
  }>({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [gmailOptIn, setGmailOptIn] = useState(false);

  const callbackUrl = normalizeAuthReturnTo(returnTo);
  const clearCachedAccountData = async () => {
    queryClient.clear();
    await queryPersister.removeQueries();
  };

  /**
   * One flow, so any attempt may be the one that creates the account. When the
   * acceptance box is ticked, a short-lived cookie carries that consent through
   * the OAuth redirect and the server stamps `termsAcceptedAt` at creation.
   * Unticked sign-ups still work: the account lands on the onboarding gate,
   * which records an explicit acceptance before any product use.
   */
  const errorCallbackParams = new URLSearchParams();
  if (callbackUrl !== "/") {
    errorCallbackParams.set("returnTo", callbackUrl);
  }
  const errorCallbackPath = `/auth?${errorCallbackParams}`;
  const getErrorCallbackHref = () =>
    globalThis.window === undefined
      ? errorCallbackPath
      : `${globalThis.window.location.origin}${errorCallbackPath}`;

  const googleMutation = useMutation({
    mutationFn: async () => {
      if (termsAccepted) {
        setTermsAcceptanceCookie();
      }

      const response = await authClient.signIn.social({
        callbackURL: gmailOptIn ? "/onboarding?gmailLink=start" : callbackUrl,
        errorCallbackURL: getErrorCallbackHref(),
        fetchOptions: { timeout: 15_000 },
        provider: "google",
        // Unified flow: an unknown Google account creates one here rather than
        // dead-ending on `signup_disabled`.
        requestSignUp: true,
      });
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not start Google sign-in."
        );
      }

      return response;
    },
    mutationKey: ["auth", "sign-in", "google"],
    onError: (error) => {
      setErrors((prev) => ({
        ...prev,
        google: error.message || "Could not start Google sign-in.",
      }));
    },
    onMutate: () => {
      setErrors((prev) => ({ ...prev, google: undefined }));
    },
    onSuccess: async (response) => {
      queryClient.clear();
      await queryPersister.removeQueries();

      const redirectUrl = response.data?.url;
      if (typeof redirectUrl === "string" && redirectUrl.length > 0) {
        globalThis.window.location.assign(redirectUrl);
      }
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signIn.passkey();
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not sign in with a passkey."
        );
      }
      return response;
    },
    mutationKey: ["auth", "sign-in", "passkey"],
    onError: (error) => {
      setErrors((prev) => ({
        ...prev,
        passkey: error.message || "Could not sign in with a passkey.",
      }));
    },
    onMutate: () => {
      setErrors((prev) => ({ ...prev, passkey: undefined }));
    },
    onSuccess: async () => {
      queryClient.clear();
      await queryPersister.removeQueries();

      if (callbackUrl === "/") {
        await navigate({
          to: "/",
        });
        return;
      }

      globalThis.window.location.assign(callbackUrl);
    },
  });

  const form = useForm({
    defaultValues: {
      email: "",
    } satisfies AuthFormValues,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z.email("Enter a valid email."),
      }),
      onSubmitAsync: async ({ value }) => {
        const normalizedEmail = value.email.trim().toLowerCase();

        try {
          if (termsAccepted) {
            setTermsAcceptanceCookie();
          }

          const response = await authClient.signIn.magicLink({
            callbackURL: callbackUrl,
            email: normalizedEmail,
            errorCallbackURL: getErrorCallbackHref(),
            // Always allowed: the response is identical whether or not an
            // account exists, so the form never reveals which addresses are
            // registered. A display name is set later in Settings.
            newUserCallbackURL: callbackUrl,
          });

          if (response.error) {
            return {
              form: AUTHENTICATION_ERROR_MESSAGE,
            };
          }

          await clearCachedAccountData();
        } catch {
          return {
            form: AUTHENTICATION_ERROR_MESSAGE,
          };
        }

        return {};
      },
    },
  });

  return (
    <>
      <form
        action={async () => {
          await form.handleSubmit();
        }}
        className="mt-8 space-y-3"
      >
        <form.Field name="email">
          {(field) => (
            <TextField>
              <FieldLabel htmlFor="auth-email">Email address</FieldLabel>
              <TextFieldInput
                aria-invalid={field.state.meta.errors.length > 0}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect="off"
                id="auth-email"
                name={field.name}
                onBlur={() => {
                  field.handleBlur();
                }}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                type="email"
                value={field.state.value}
              />
              {field.state.meta.errors.map((error) => (
                <p
                  className="text-caption text-destructive"
                  key={error?.message}
                >
                  {error?.message ?? "An unknown error occurred."}
                </p>
              ))}
            </TextField>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            email: state.values.email,
            isSubmitted: state.isSubmitted,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, email, isSubmitted, isSubmitting }) => {
            let submitContent: ReactNode = (
              <>
                <HugeiconsIcon className="size-4 shrink-0" icon={Mail01Icon} />
                Continue with magic link
              </>
            );
            if (isSubmitting) {
              submitContent = "Sending…";
            } else if (isSubmitted) {
              submitContent = (
                <>
                  <HugeiconsIcon
                    className="size-4 shrink-0"
                    icon={Mail01Icon}
                  />
                  Magic link sent to {email.trim().toLowerCase()}
                </>
              );
            }

            return (
              <Button
                className="group relative w-full justify-center gap-3"
                disabled={!canSubmit}
                type="submit"
              >
                {authClient.isLastUsedLoginMethod("magic-link") && (
                  <AuthLastUsedHint />
                )}
                {submitContent}
              </Button>
            );
          }}
        </form.Subscribe>

        <form.Subscribe selector={(state) => ({ errorMap: state.errorMap })}>
          {({ errorMap }) =>
            errorMap.onSubmit && (
              <output
                aria-live="assertive"
                className="mt-4 text-body text-destructive"
              >
                {errorMap.onSubmit.form}
              </output>
            )
          }
        </form.Subscribe>
      </form>

      <div className="mt-6 mb-3 h-px w-full bg-border" />

      <Button
        className="group relative mt-3 w-full cursor-pointer justify-center gap-3"
        disabled={googleMutation.isPending}
        onClick={() => {
          googleMutation.mutate();
        }}
        type="button"
        variant="outline"
      >
        {authClient.isLastUsedLoginMethod("google") && <AuthLastUsedHint />}
        {googleMutation.isPending ? (
          "Continuing…"
        ) : (
          <>
            <GoogleLogo className="size-4 shrink-0" />
            Continue with Google
          </>
        )}
      </Button>

      <Button
        className="group relative mt-3 w-full justify-center gap-3"
        disabled={passkeyMutation.isPending}
        onClick={() => {
          passkeyMutation.mutate();
        }}
        type="button"
        variant="outline"
      >
        {authClient.isLastUsedLoginMethod("passkey") && <AuthLastUsedHint />}
        <HugeiconsIcon className="size-4 shrink-0" icon={Key02Icon} />
        Continue with passkey
      </Button>

      <div className="mt-5 space-y-3 border-t border-border pt-4">
        <label
          className="flex items-start gap-3 text-body-sm text-muted-fg"
          htmlFor="auth-terms"
        >
          <Checkbox
            checked={termsAccepted}
            className="mt-0.5"
            id="auth-terms"
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
            <Link className="text-fg underline" target="_blank" to="/privacy">
              Privacy Policy
            </Link>
            . New accounts need this; you can also accept during setup.
          </span>
        </label>
        <label
          className="flex items-start gap-3 text-body-sm text-muted-fg"
          htmlFor="auth-gmail-opt-in"
        >
          <Checkbox
            checked={gmailOptIn}
            className="mt-0.5"
            id="auth-gmail-opt-in"
            onCheckedChange={setGmailOptIn}
          >
            <CheckboxIndicator />
          </Checkbox>
          <span>
            Also add my Google account as a Gmail inbox. Google asks for
            permission separately after sign-in.
          </span>
        </label>
      </div>

      {hasText(errors.google) ? (
        <output
          aria-live="assertive"
          className="mt-4 text-body text-destructive"
        >
          {errors.google}
        </output>
      ) : null}
      {hasText(errors.passkey) ? (
        <output
          aria-live="assertive"
          className="mt-4 text-body text-destructive"
        >
          {errors.passkey}
        </output>
      ) : null}
    </>
  );
};

const PreviewPersonaPicker = ({ navigate }: { navigate: AuthNavigate }) => {
  const [error, setError] = useState<string | null>(null);
  const [pendingPersona, setPendingPersona] = useState<PreviewPersona | null>(
    null
  );

  if (!isPreviewPersonasAvailable()) {
    return null;
  }

  const startPreviewPersona = async (persona: PreviewPersona) => {
    setError(null);
    setPendingPersona(persona);

    const complete = () => {
      setPendingPersona(null);
    };

    try {
      const response = await fetch("/api/preview-persona", {
        body: JSON.stringify({ persona }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        setError("Could not start preview persona.");
        complete();
        return;
      }

      setPreviewPersona(persona);
      setDemoModeEnabled(persona === "gmail");
      setManagedDemoModeEnabled(persona === "managed");

      await navigate({ to: "/" });
      complete();
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Could not start preview persona."
      );
      complete();
    }
  };

  return (
    <div className="mt-6 space-y-3">
      {/* Buttons are `whitespace-nowrap shrink-0`, so equal grid columns force
          the longer labels to overflow. Let them size to content and wrap. */}
      <div className="flex flex-wrap gap-2">
        {previewPersonaOptions.map((option) => (
          <Button
            className="justify-center text-center"
            disabled={pendingPersona !== null}
            key={option.persona}
            onClick={() => void startPreviewPersona(option.persona)}
            type="button"
            variant="outline"
          >
            {pendingPersona === option.persona ? "Opening…" : option.label}
          </Button>
        ))}
      </div>
      {hasText(error) ? (
        <output aria-live="assertive" className="text-body text-destructive">
          {error}
        </output>
      ) : null}
    </div>
  );
};

export const AuthScreen = () => {
  const { error, returnTo } = authRouteApi.useSearch();
  const navigate = authRouteApi.useNavigate();
  const authError = hasText(error) ? AUTHENTICATION_ERROR_MESSAGE : null;

  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-bg md:grid-cols-2">
      {/* Form first, in DOM and on screen: it is the task, the atmosphere is
          not. The visual sits second and is ordered right on wide viewports. */}
      <div className="flex size-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-title-md font-medium tracking-tight text-fg">
            Continue to Quieter
          </h1>
          <p className="mt-2 text-body text-muted-fg">
            Sign in, or create an account with the same address.
          </p>

          <AuthCredentials
            key={returnTo ?? ""}
            navigate={navigate}
            returnTo={returnTo}
          />

          <PreviewPersonaPicker navigate={navigate} />

          {hasText(authError) ? (
            <output
              aria-live="assertive"
              className="mt-4 text-body text-destructive"
            >
              {authError}
            </output>
          ) : null}
        </div>
      </div>
      <div className="size-full min-h-0 border-l bg-bg-surface max-md:hidden">
        <AuthVisual />
      </div>
    </div>
  );
};
