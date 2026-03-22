"use client";
import { GoogleIcon, Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quietr/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { mutationOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { getErrorMessage, getFieldErrorMessage } from "~/lib/errors";
import { useTRPC } from "~/lib/trpc";

type AuthMode = "login" | "signup";

type AuthScreenProps = {
  authErrorCode?: string | null;
  mode: AuthMode;
};

type AuthFormValues = {
  email: string;
  name: string;
};

const getAuthErrorLabel = (code: string | null) => {
  switch (code) {
    case "INVALID_TOKEN":
      return "That link is invalid.";
    case "EXPIRED_TOKEN":
      return "That link has expired.";
    case "new_user_signup_disabled":
      return "That email needs to sign up first.";
    default:
      return code ? `Auth error: ${code}` : null;
  }
};

const getAuthResponseError = (response: unknown, fallback: string) => {
  if (response && typeof response === "object" && "error" in response && response.error) {
    return getErrorMessage(response.error, fallback);
  }

  return null;
};

const getLatestAuthAction = (
  magicLinkSubmittedAt: number,
  googleSubmittedAt: number,
  passkeySubmittedAt: number,
) => {
  const latestSubmittedAt = Math.max(magicLinkSubmittedAt, googleSubmittedAt, passkeySubmittedAt);

  if (latestSubmittedAt === 0) {
    return {
      latestAction: null,
      latestSubmittedAt,
    } as const;
  }

  if (latestSubmittedAt === magicLinkSubmittedAt) {
    return {
      latestAction: "magic-link",
      latestSubmittedAt,
    } as const;
  }

  if (latestSubmittedAt === googleSubmittedAt) {
    return {
      latestAction: "google",
      latestSubmittedAt,
    } as const;
  }

  return {
    latestAction: "passkey",
    latestSubmittedAt,
  } as const;
};

export const AuthScreen = ({ authErrorCode = null, mode }: AuthScreenProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const authError = getAuthErrorLabel(authErrorCode);

  const isSignup = mode === "signup";
  const pageTitle = isSignup ? "Sign up" : "Log in";
  const pageAction = isSignup ? "Create with magic link" : "Send magic link";
  const alternateHref = isSignup ? "/login" : "/signup";
  const alternateLabel = isSignup ? "Log in" : "Sign up";

  const googleMutationOptions = mutationOptions({
    mutationFn: async () => {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      const responseError = getAuthResponseError(response, "Could not start Google sign-in.");
      if (responseError) {
        throw new Error(responseError);
      }
    },
    mutationKey: ["auth", mode, "google"],
  });
  const googleMutation = useMutation(googleMutationOptions);

  const passkeyMutationOptions = mutationOptions({
    mutationFn: async () => {
      const response = await authClient.signIn.passkey();
      const responseError = getAuthResponseError(response, "Could not sign in with a passkey.");
      if (responseError) {
        throw new Error(responseError);
      }

      router.push("/");
    },
    mutationKey: ["auth", mode, "passkey"],
  });
  const passkeyMutation = useMutation(passkeyMutationOptions);

  const magicLinkMutationOptions = mutationOptions({
    mutationFn: async ({ email, name }: AuthFormValues) => {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();
      const status = await queryClient.fetchQuery(
        trpc.auth.getUserStatus.queryOptions(
          { email: normalizedEmail },
          {
            staleTime: 0,
          },
        ),
      );

      if (isSignup && status.exists) {
        throw new Error("That email already has an account.");
      }

      if (!isSignup && !status.exists) {
        throw new Error("That email needs to sign up first.");
      }

      const response = await authClient.signIn.magicLink({
        callbackURL: "/",
        email: normalizedEmail,
        errorCallbackURL: isSignup ? "/signup" : "/login",
        name: isSignup ? normalizedName : undefined,
        newUserCallbackURL: "/",
      });
      const responseError = getAuthResponseError(response, "Could not create a magic link.");
      if (responseError) {
        throw new Error(responseError);
      }

      return await queryClient.fetchQuery(
        trpc.auth.getEmailPreview.queryOptions(
          { email: normalizedEmail },
          {
            staleTime: 0,
          },
        ),
      );
    },
    mutationKey: ["auth", mode, "magic-link"],
  });
  const magicLinkMutation = useMutation(magicLinkMutationOptions);

  const form = useForm({
    defaultValues: {
      email: "",
      name: "",
    } satisfies AuthFormValues,
    onSubmit: async ({ value }) => {
      await magicLinkMutation.mutateAsync(value);
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic:
        mode === "signup"
          ? z.object({
              email: z.string().trim().min(1, "Email is required.").email("Enter a valid email."),
              name: z.string().trim().min(1, "Name is required."),
            })
          : z.object({
              email: z.string().trim().min(1, "Email is required.").email("Enter a valid email."),
              name: z.string(),
            }),
    },
  });

  const { latestAction, latestSubmittedAt } = getLatestAuthAction(
    magicLinkMutation.submittedAt,
    googleMutation.submittedAt,
    passkeyMutation.submittedAt,
  );

  const latestMutationError =
    latestAction === "magic-link"
      ? magicLinkMutation.status === "error"
        ? getErrorMessage(magicLinkMutation.error, "Could not create a magic link.")
        : null
      : latestAction === "google"
        ? googleMutation.status === "error"
          ? getErrorMessage(googleMutation.error, "Could not start Google sign-in.")
          : null
        : latestAction === "passkey"
          ? passkeyMutation.status === "error"
            ? getErrorMessage(passkeyMutation.error, "Could not sign in with a passkey.")
            : null
          : null;

  const preview =
    latestAction === "magic-link" && magicLinkMutation.status === "success"
      ? magicLinkMutation.data
      : null;

  const isAnyPending =
    googleMutation.isPending || magicLinkMutation.isPending || passkeyMutation.isPending;

  return (
    <div className="grid min-h-dvh w-full place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground-dark">{pageTitle}</h1>

        <form
          className="mt-8 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {isSignup ? (
            <form.Field name="name">
              {(field) => {
                const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                return (
                  <TextField>
                    <TextFieldInput
                      aria-invalid={fieldError ? true : undefined}
                      autoComplete="name"
                      name={field.name}
                      onBlur={() => field.handleBlur()}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="Name"
                      value={field.state.value}
                    />
                    {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
                  </TextField>
                );
              }}
            </form.Field>
          ) : null}

          <form.Field name="email">
            {(field) => {
              const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

              return (
                <TextField>
                  <TextFieldInput
                    aria-invalid={fieldError ? true : undefined}
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
                  {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
                </TextField>
              );
            }}
          </form.Field>

          <Button className="w-full justify-center gap-3" disabled={isAnyPending} type="submit">
            {magicLinkMutation.isPending ? (
              "Sending..."
            ) : (
              <>
                <HugeiconsIcon className="size-4 shrink-0" icon={Mail01Icon} />
                {pageAction}
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 mb-3 h-px w-full bg-border" />

        <Button
          className="mt-3 w-full justify-center gap-3"
          disabled={isAnyPending}
          onClick={() => void googleMutation.mutateAsync()}
          type="button"
          variant="outline"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={GoogleIcon} />
          Continue with Google
        </Button>

        <Button
          className="mt-3 w-full justify-center gap-3"
          disabled={isAnyPending}
          onClick={() => void passkeyMutation.mutateAsync()}
          type="button"
          variant="outline"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={Key02Icon} />
          Continue with passkey
        </Button>

        <form.Subscribe
          selector={(state) => ({
            email: state.values.email,
            isDirty: state.isDirty,
          })}
        >
          {({ email, isDirty }) => {
            const normalizedEmail = email.trim().toLowerCase();
            const error = latestSubmittedAt === 0 && !isDirty ? authError : latestMutationError;
            const activePreview = preview?.email === normalizedEmail ? preview : null;

            return (
              <>
                {activePreview ? (
                  <div className="mt-4 rounded-md border border-border px-3 py-3 text-sm">
                    <p className="text-muted-foreground">Placeholder link</p>
                    <Link
                      className="mt-2 block break-all text-foreground underline"
                      href={activePreview.url}
                    >
                      {activePreview.url}
                    </Link>
                  </div>
                ) : null}

                {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
              </>
            );
          }}
        </form.Subscribe>

        <p className="mt-6 text-sm text-muted-foreground">
          <Link className="text-foreground underline" href={alternateHref}>
            {alternateLabel}
          </Link>
        </p>
      </div>
    </div>
  );
};
