"use client";

import { Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { domAnimation, LazyMotion, m } from "motion/react";
import { useState } from "react";
import { z } from "zod";
import { AuthVisual } from "~/components/auth-visual";
import { GoogleLogo } from "~/components/google-logo";
import { authClient } from "~/lib/auth";

const authRouteApi = getRouteApi("/auth");
const AUTHENTICATION_ERROR_MESSAGE =
  "Unable to authenticate. Please check your credentials or try again.";

type AuthNavigate = ReturnType<(typeof authRouteApi)["useNavigate"]>;

type AuthFormValues = {
  email: string;
  name?: string;
};

const AuthLastUsedHint = () => (
  <LazyMotion features={domAnimation}>
    <span
      aria-hidden
      className="squircle pointer-events-none absolute -inset-e-2.5 -top-2.5 isolate overflow-hidden rounded-md p-px shadow-sm"
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
      <span className="squircle relative block rounded-[inherit] bg-background px-2 py-1 text-[0.625rem] leading-none font-medium tracking-wide text-muted-foreground">
        Last used
      </span>
    </span>
  </LazyMotion>
);

const AuthCredentials = ({
  mode,
  navigate,
}: {
  mode: "login" | "signup";
  navigate: AuthNavigate;
}) => {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<{
    google?: string;
    passkey?: string;
  }>({});

  const isSignup = mode === "signup";

  const errorCallbackHref =
    typeof globalThis.window !== "undefined"
      ? `${globalThis.window.location.origin}/auth?mode=${isSignup ? "signup" : "login"}`
      : "/auth";

  const googleMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not start Google sign-in.");
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
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signIn.passkey();
      if (response.error) {
        throw new Error(response.error.message ?? "Could not sign in with a passkey.");
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
      await queryClient.invalidateQueries();
      await navigate({
        to: "/",
      });
    },
  });

  const form = useForm({
    defaultValues: {
      email: "",
      name: "",
    } satisfies AuthFormValues,
    validationLogic: revalidateLogic(),
    validators: {
      onSubmitAsync: async ({ value }) => {
        const normalizedEmail = value.email.trim().toLowerCase();

        try {
          const response = await authClient.signIn.magicLink({
            callbackURL: "/",
            email: normalizedEmail,
            errorCallbackURL: errorCallbackHref,
            name: isSignup ? value.name.trim() : undefined,
            newUserCallbackURL: "/",
          });

          if (response.error) {
            return {
              form: AUTHENTICATION_ERROR_MESSAGE,
            };
          }
        } catch {
          return {
            form: AUTHENTICATION_ERROR_MESSAGE,
          };
        }
      },
      onDynamic:
        mode === "signup"
          ? z.object({
              email: z.email("Enter a valid email."),
              name: z.string().trim().min(1, "Name is required."),
            })
          : z.object({
              email: z.email("Enter a valid email."),
              name: z.string(),
            }),
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
        {isSignup ? (
          <form.Field name="name">
            {(field) => {
              return (
                <TextField>
                  <TextFieldInput
                    aria-label="Name"
                    aria-invalid={field.state.meta.errors.length > 0}
                    autoComplete="name"
                    name={field.name}
                    onBlur={() => field.handleBlur()}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Name"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p className="text-xs text-destructive" key={error?.message}>
                      {error?.message ?? "An unknown error occurred."}
                    </p>
                  ))}
                </TextField>
              );
            }}
          </form.Field>
        ) : null}

        <form.Field name="email">
          {(field) => {
            return (
              <TextField>
                <TextFieldInput
                  aria-label="Email address"
                  aria-invalid={field.state.meta.errors.length > 0}
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  name={field.name}
                  onBlur={() => field.handleBlur()}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Email"
                  type="email"
                  value={field.state.value}
                />
                {field.state.meta.errors.map((error) => (
                  <p className="text-xs text-destructive" key={error?.message}>
                    {error?.message ?? "An unknown error occurred."}
                  </p>
                ))}
              </TextField>
            );
          }}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            email: state.values.email,
            isSubmitted: state.isSubmitted,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, email, isSubmitted, isSubmitting }) => (
            <Button
              className="group relative w-full justify-center gap-3"
              disabled={!canSubmit}
              type="submit"
            >
              {authClient.isLastUsedLoginMethod("magic-link") && <AuthLastUsedHint />}
              {isSubmitting ? (
                "Sending…"
              ) : isSubmitted ? (
                <>
                  <HugeiconsIcon className="size-4 shrink-0" icon={Mail01Icon} />
                  Magic link sent to {email.trim().toLowerCase()}
                </>
              ) : (
                <>
                  <HugeiconsIcon className="size-4 shrink-0" icon={Mail01Icon} />
                  Continue with magic link
                </>
              )}
            </Button>
          )}
        </form.Subscribe>

        <form.Subscribe selector={(state) => ({ errorMap: state.errorMap })}>
          {({ errorMap }) =>
            errorMap.onSubmit && (
              <p aria-live="assertive" className="mt-4 text-sm text-destructive" role="status">
                {errorMap.onSubmit.form}
              </p>
            )
          }
        </form.Subscribe>
      </form>

      <div className="mt-6 mb-3 h-px w-full bg-border" />

      <Button
        className="group relative mt-3 w-full cursor-pointer justify-center gap-3"
        disabled={googleMutation.isPending}
        onClick={() => void googleMutation.mutateAsync()}
        type="button"
        variant="outline"
      >
        {authClient.isLastUsedLoginMethod("google") && <AuthLastUsedHint />}
        <GoogleLogo className="size-4 shrink-0" />
        Continue with Google
      </Button>

      <Button
        className="group relative mt-3 w-full justify-center gap-3"
        disabled={passkeyMutation.isPending}
        onClick={() => void passkeyMutation.mutateAsync()}
        type="button"
        variant="outline"
      >
        {authClient.isLastUsedLoginMethod("passkey") && <AuthLastUsedHint />}
        <HugeiconsIcon className="size-4 shrink-0" icon={Key02Icon} />
        Continue with passkey
      </Button>

      {errors.google ? (
        <p aria-live="assertive" className="mt-4 text-sm text-destructive" role="status">
          {errors.google}
        </p>
      ) : null}
      {errors.passkey ? (
        <p aria-live="assertive" className="mt-4 text-sm text-destructive" role="status">
          {errors.passkey}
        </p>
      ) : null}
    </>
  );
};

export const AuthScreen = () => {
  const { mode } = authRouteApi.useSearch();
  const navigate = authRouteApi.useNavigate();

  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-background md:grid-cols-2">
      <div className="size-full min-h-0 border-r bg-background-light max-md:hidden">
        <AuthVisual />
      </div>
      <div className="flex size-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-medium tracking-tight text-foreground">
            {mode === "signup" ? "Sign up" : "Log in"}
          </h1>

          <AuthCredentials key={mode} mode={mode} navigate={navigate} />

          <p className="mt-6 text-sm text-muted-foreground">
            <Link
              className="text-foreground underline"
              search={{ mode: mode === "signup" ? "login" : "signup" }}
              to="/auth"
            >
              {mode === "signup" ? "Log in" : "Sign up"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
