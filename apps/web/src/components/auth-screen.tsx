"use client";
import { Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { m, domAnimation, LazyMotion } from "motion/react";
import { useState } from "react";
import { z } from "zod";
import { GoogleLogo } from "~/components/google-logo";
import { authClient } from "~/lib/auth";
import { orpc } from "~/lib/orpc";

type AuthFormValues = {
  email: string;
  name?: string;
};

const AuthLastUsedHint = () => (
  <span
    aria-hidden
    className="squircle pointer-events-none absolute -inset-e-2.5 -top-2.5 overflow-hidden rounded-md border border-border bg-background px-2 py-1 text-[0.625rem] leading-none font-medium tracking-wide text-muted-foreground shadow-sm"
  >
    Last used
    <LazyMotion features={domAnimation}>
      <m.span
        aria-hidden
        style={{
          background:
            "linear-gradient(135deg, transparent 0%, var(--primary) 50%, transparent 100%)",
        }}
        className="absolute -inset-y-4 left-0 w-1/4"
        animate={{ x: ["-200%", "500%"] }}
        transition={{ duration: 2, repeat: Infinity, repeatDelay: 2.5, ease: "easeInOut" }}
      />
    </LazyMotion>
  </span>
);

export const AuthScreen = ({ mode }: { mode: "login" | "signup" }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<{
    google?: string;
    passkey?: string;
  }>({});

  const isSignup = mode === "signup";
  const pageTitle = isSignup ? "Sign up" : "Log in";
  const alternateHref = isSignup ? "/login" : "/signup";
  const alternateLabel = isSignup ? "Log in" : "Sign up";

  const googleMutation = useMutation({
    mutationFn: async () => {
      setErrors({
        ...errors,
        google: undefined,
      });

      await authClient.signIn
        .social({
          provider: "google",
          callbackURL: "/",
        })
        .then((response) => {
          if (response.error)
            setErrors({
              ...errors,
              google: response.error.message ?? "Could not start Google sign-in.",
            });
        })
        .catch((error) => {
          setErrors({
            ...errors,
            google: (error as Error).message ?? "Could not start Google sign-in.",
          });
        });
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      setErrors({
        ...errors,
        passkey: undefined,
      });

      await authClient.signIn
        .passkey()
        .then((response) => {
          if (response.error)
            setErrors({
              ...errors,
              passkey: response.error.message ?? "Could not sign in with a passkey.",
            });
        })
        .catch((error) => {
          setErrors({
            ...errors,
            passkey: (error as Error).message ?? "Could not sign in with a passkey.",
          });
        });

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
            errorCallbackURL: isSignup ? "/signup" : "/login",
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
    <div className="grid min-h-dvh w-full place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">{pageTitle}</h1>

        <form
          action={async () => {
            await form.handleSubmit();
          }}
          className="mt-8 space-y-3"
        >
          {isSignup && (
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
          )}

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
              isSubmitting: state.isSubmitting,
              isSubmitted: state.isSubmitted,
              email: state.values.email,
            })}
          >
            {({ canSubmit, isSubmitting, isSubmitted, email }) => (
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
                    {isSignup ? "Create with magic link" : "Send magic link"}
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
          className="group relative mt-3 w-full justify-center gap-3"
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

        {errors.google && <p className="mt-4 text-sm text-destructive">{errors.google}</p>}
        {errors.passkey && <p className="mt-4 text-sm text-destructive">{errors.passkey}</p>}

        <p className="mt-6 text-sm text-muted-foreground">
          <Link className="text-foreground underline" to={alternateHref}>
            {alternateLabel}
          </Link>
        </p>
      </div>
    </div>
  );
};
