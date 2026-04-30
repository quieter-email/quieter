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
import { orpc } from "~/lib/orpc";

const authRouteApi = getRouteApi("/auth");

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
      setErrors((prev) => ({ ...prev, google: undefined }));

      await authClient.signIn
        .social({
          provider: "google",
          callbackURL: "/",
        })
        .then((response) => {
          if (response.error)
            setErrors((prev) => ({
              ...prev,
              google: response.error.message ?? "Could not start Google sign-in.",
            }));
        })
        .catch((error) => {
          setErrors((prev) => ({
            ...prev,
            google: (error as Error).message ?? "Could not start Google sign-in.",
          }));
        });
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      setErrors((prev) => ({ ...prev, passkey: undefined }));

      try {
        const response = await authClient.signIn.passkey();

        if (response.error) {
          setErrors((prev) => ({
            ...prev,
            passkey: response.error.message ?? "Could not sign in with a passkey.",
          }));
          return;
        }

        await navigate({
          to: "/",
        });
      } catch (error) {
        setErrors((prev) => ({
          ...prev,
          passkey: (error as Error).message ?? "Could not sign in with a passkey.",
        }));
      }
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

        const status = await queryClient.fetchQuery(
          orpc.auth.getUserStatus.queryOptions({
            input: { email: normalizedEmail },
            staleTime: 0,
          }),
        );

        if (isSignup && status.exists) {
          return {
            form: "Email already in use. Please log in instead or use a different email.",
          };
        }

        if (!isSignup && !status.exists) {
          return {
            form: "Account not found. Please sign up first.",
          };
        }

        await authClient.signIn
          .magicLink({
            callbackURL: "/",
            email: normalizedEmail,
            errorCallbackURL: errorCallbackHref,
            name: isSignup ? value.name.trim() : undefined,
            newUserCallbackURL: "/",
          })
          .then((response) => {
            if (response.error)
              return {
                form: response.error.message ?? "Could not authenticate with email.",
              };
          })
          .catch((error) => {
            return {
              form: (error as Error).message ?? "Could not authenticate with email.",
            };
          });
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
                    aria-invalid={field.state.meta.errors.length > 0}
                    autoComplete="name"
                    name={field.name}
                    onBlur={() => field.handleBlur()}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Name"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.map((error, i) => (
                    <p className="text-xs text-destructive" key={i}>
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
                {field.state.meta.errors.map((error, i) => (
                  <p className="text-xs text-destructive" key={i}>
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
                "Sending..."
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
              <p className="mt-4 text-sm text-destructive">{errorMap.onSubmit.form}</p>
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

      {errors.google ? <p className="mt-4 text-sm text-destructive">{errors.google}</p> : null}
      {errors.passkey ? <p className="mt-4 text-sm text-destructive">{errors.passkey}</p> : null}
    </>
  );
};

export const AuthScreen = () => {
  const { mode } = authRouteApi.useSearch();
  const navigate = authRouteApi.useNavigate();

  return (
    <div className="grid min-h-dvh w-dvw bg-background md:grid-cols-2">
      <div className="size-full border-r bg-background-light max-md:hidden">
        <AuthVisual />
      </div>
      <div className="flex size-full items-center justify-center">
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
