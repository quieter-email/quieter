"use client";

import { Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AuthLayout } from "@quieter/app/components/auth-layout";
import { GoogleLogo } from "@quieter/app/components/google-logo";
import { setDemoModeEnabled } from "@quieter/app/features/settings/domain/demo-mode-setting";
import { setManagedDemoModeEnabled } from "@quieter/app/features/settings/domain/managed-demo-mode-setting";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  isPreviewPersonasAvailable,
  setPreviewPersona,
} from "@quieter/app/lib/preview-personas";
import type { PreviewPersona } from "@quieter/app/lib/preview-personas";
import { queryPersister } from "@quieter/app/lib/query-persister";
import { appFetch } from "@quieter/app/runtime";
import { desktopAuthQuerySchema } from "@quieter/auth/desktop";
import type { DesktopAuthQuery } from "@quieter/auth/desktop";
import { Button } from "@quieter/ui/button";
import { FieldLabel } from "@quieter/ui/field";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { domAnimation, LazyMotion, m } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

const authRouteApi = getRouteApi("/_app/auth");
const AUTHENTICATION_ERROR_MESSAGE =
  "Unable to authenticate. Please check your credentials or try again.";

const normalizeAuthReturnTo = (returnTo?: string) => {
  if (!returnTo) {
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
      className="pointer-events-none absolute -inset-e-2.5 -top-2.5 isolate overflow-hidden rounded-md p-px shadow-sm squircle *:pointer-events-none"
    >
      <m.span
        animate={{ rotate: 360 }}
        aria-hidden
        className="auth-sheen absolute top-1/2 left-1/2 aspect-square w-[300%] -translate-1/2"
        transition={{ duration: 5, ease: "linear", repeat: Infinity }}
      />
      <span
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- Inherits the parent badge radius by design.
        className="relative block rounded-[inherit] bg-bg-raised px-2 py-1 text-micro font-medium tracking-wide text-muted-fg squircle"
      >
        Last used
      </span>
    </span>
  </LazyMotion>
);

export const AuthCredentials = ({
  electronQuery,
  returnTo,
}: {
  electronQuery?: DesktopAuthQuery;
  returnTo?: string;
}) => {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<{
    google?: string;
    passkey?: string;
    terms?: string;
  }>({});

  const callbackUrl = normalizeAuthReturnTo(returnTo);
  const clearCachedAccountData = async () => {
    queryClient.clear();
    await queryPersister.removeQueries();
  };

  /**
   * One flow, so any attempt may be the one that creates the account. The
   * server blocks user creation without the acceptance cookie, so the box is
   * required up front rather than behind a separate Sign up screen.
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
      const response = await authClient.signIn.social({
        callbackURL: callbackUrl,
        errorCallbackURL: getErrorCallbackHref(),
        fetchOptions: { query: electronQuery, timeout: 15_000 },
        provider: "google",
        // Unified flow: an unknown Google account creates one here rather than
        // dead-ending on `signup_disabled`.
        requestSignUp: true,
      });
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not start Google sign-in.",
          { cause: response.error }
        );
      }

      return response;
    },
    mutationKey: ["auth", "sign-in", "google"],
    onError: (error) => {
      toastError(error, {
        boundary: "auth-google-sign-in",
        fallback: AUTHENTICATION_ERROR_MESSAGE,
      });
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
      const response = await authClient.signIn.passkey({
        fetchOptions: { query: electronQuery },
      });
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not sign in with a passkey.",
          { cause: response.error }
        );
      }
      return response;
    },
    mutationKey: ["auth", "sign-in", "passkey"],
    onError: (error) => {
      toastError(error, {
        boundary: "auth-passkey-sign-in",
        fallback: AUTHENTICATION_ERROR_MESSAGE,
      });
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
          const response = await authClient.signIn.magicLink({
            callbackURL: callbackUrl,
            email: normalizedEmail,
            errorCallbackURL: getErrorCallbackHref(),
            fetchOptions: { query: electronQuery },
            // Always allowed: the response is identical whether or not an
            // account exists, so the form never reveals which addresses are
            // registered. A display name is set later in Settings.
            newUserCallbackURL: callbackUrl,
          });

          if (response.error) {
            toastError(response.error, {
              boundary: "auth-magic-link",
              fallback: AUTHENTICATION_ERROR_MESSAGE,
            });
            return {
              form: AUTHENTICATION_ERROR_MESSAGE,
            };
          }

          await clearCachedAccountData();
        } catch (error) {
          toastError(error, {
            boundary: "auth-magic-link",
            fallback: AUTHENTICATION_ERROR_MESSAGE,
          });
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
              <Button disabled={!canSubmit} fullWidth type="submit">
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
        className="mt-3"
        disabled={googleMutation.isPending}
        onClick={() => {
          googleMutation.mutate();
        }}
        fullWidth
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
        className="mt-3"
        disabled={passkeyMutation.isPending}
        onClick={() => {
          passkeyMutation.mutate();
        }}
        fullWidth
        type="button"
        variant="outline"
      >
        {authClient.isLastUsedLoginMethod("passkey") && <AuthLastUsedHint />}
        <HugeiconsIcon className="size-4 shrink-0" icon={Key02Icon} />
        Continue with passkey
      </Button>

      {errors.google ? (
        <output
          aria-live="assertive"
          className="mt-4 text-body text-destructive"
        >
          {errors.google}
        </output>
      ) : null}
      {errors.passkey ? (
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
  const session = authClient.useSession();
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
      const response = await appFetch("/api/preview-persona", {
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
      await session.refetch();

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
      {error ? (
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
  const authError = error ? AUTHENTICATION_ERROR_MESSAGE : null;
  const returnUrl = new URL(returnTo ?? "/", "https://quieter.local");
  const electronQuery =
    returnUrl.pathname === "/desktop/auth"
      ? desktopAuthQuerySchema.safeParse(
          Object.fromEntries(returnUrl.searchParams)
        ).data
      : undefined;

  return (
    <AuthLayout title="Continue to Quieter">
      <AuthCredentials
        electronQuery={electronQuery}
        key={returnTo ?? ""}
        returnTo={returnTo}
      />

      <PreviewPersonaPicker navigate={navigate} />

      {authError ? (
        <output
          aria-live="assertive"
          className="mt-4 text-body text-destructive"
        >
          {authError}
        </output>
      ) : null}
    </AuthLayout>
  );
};
