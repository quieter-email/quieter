"use client";
import { Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quietr/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { mutationOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { getErrorMessage, getFieldErrorMessage } from "~/lib/errors";
import { orpc } from "~/lib/orpc";
import { toAuthSearch, toMailboxSearch } from "~/lib/search-params";

type AuthMode = "login" | "signup";

type AuthScreenProps = {
  authErrorCode?: string | null;
  mode: AuthMode;
};

type AuthFormValues = {
  email: string;
  name: string;
};

const GoogleLogo = ({ className }: { className?: string }) => {
  return (
    <svg
      aria-hidden="true"
      className={className}
      overflow="hidden"
      viewBox="0 0 268.152 273.883"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      xmlSpace="preserve"
    >
      <defs>
        <linearGradient id="google-a">
          <stop offset="0" stopColor="#0fbc5c" />
          <stop offset="1" stopColor="#0cba65" />
        </linearGradient>
        <linearGradient id="google-g">
          <stop offset=".231" stopColor="#0fbc5f" />
          <stop offset=".312" stopColor="#0fbc5f" />
          <stop offset=".366" stopColor="#0fbc5e" />
          <stop offset=".458" stopColor="#0fbc5d" />
          <stop offset=".54" stopColor="#12bc58" />
          <stop offset=".699" stopColor="#28bf3c" />
          <stop offset=".771" stopColor="#38c02b" />
          <stop offset=".861" stopColor="#52c218" />
          <stop offset=".915" stopColor="#67c30f" />
          <stop offset="1" stopColor="#86c504" />
        </linearGradient>
        <linearGradient id="google-h">
          <stop offset=".142" stopColor="#1abd4d" />
          <stop offset=".248" stopColor="#6ec30d" />
          <stop offset=".312" stopColor="#8ac502" />
          <stop offset=".366" stopColor="#a2c600" />
          <stop offset=".446" stopColor="#c8c903" />
          <stop offset=".54" stopColor="#ebcb03" />
          <stop offset=".616" stopColor="#f7cd07" />
          <stop offset=".699" stopColor="#fdcd04" />
          <stop offset=".771" stopColor="#fdce05" />
          <stop offset=".861" stopColor="#ffce0a" />
        </linearGradient>
        <linearGradient id="google-f">
          <stop offset=".316" stopColor="#ff4c3c" />
          <stop offset=".604" stopColor="#ff692c" />
          <stop offset=".727" stopColor="#ff7825" />
          <stop offset=".885" stopColor="#ff8d1b" />
          <stop offset="1" stopColor="#ff9f13" />
        </linearGradient>
        <linearGradient id="google-b">
          <stop offset=".231" stopColor="#ff4541" />
          <stop offset=".312" stopColor="#ff4540" />
          <stop offset=".458" stopColor="#ff4640" />
          <stop offset=".54" stopColor="#ff473f" />
          <stop offset=".699" stopColor="#ff5138" />
          <stop offset=".771" stopColor="#ff5b33" />
          <stop offset=".861" stopColor="#ff6c29" />
          <stop offset="1" stopColor="#ff8c18" />
        </linearGradient>
        <linearGradient id="google-d">
          <stop offset=".408" stopColor="#fb4e5a" />
          <stop offset="1" stopColor="#ff4540" />
        </linearGradient>
        <linearGradient id="google-c">
          <stop offset=".132" stopColor="#0cba65" />
          <stop offset=".21" stopColor="#0bb86d" />
          <stop offset=".297" stopColor="#09b479" />
          <stop offset=".396" stopColor="#08ad93" />
          <stop offset=".477" stopColor="#0aa6a9" />
          <stop offset=".568" stopColor="#0d9cc6" />
          <stop offset=".667" stopColor="#1893dd" />
          <stop offset=".769" stopColor="#258bf1" />
          <stop offset=".859" stopColor="#3086ff" />
        </linearGradient>
        <linearGradient id="google-e">
          <stop offset=".366" stopColor="#ff4e3a" />
          <stop offset=".458" stopColor="#ff8a1b" />
          <stop offset=".54" stopColor="#ffa312" />
          <stop offset=".616" stopColor="#ffb60c" />
          <stop offset=".771" stopColor="#ffcd0a" />
          <stop offset=".861" stopColor="#fecf0a" />
          <stop offset=".915" stopColor="#fecf08" />
          <stop offset="1" stopColor="#fdcd01" />
        </linearGradient>
        <linearGradient
          id="google-s"
          x1="219.7"
          x2="254.467"
          xlinkHref="#google-a"
          y1="329.535"
          y2="329.535"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          id="google-m"
          cx="109.627"
          cy="135.862"
          r="71.46"
          fx="109.627"
          fy="135.862"
          gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-b"
        />
        <radialGradient
          id="google-n"
          cx="45.259"
          cy="279.274"
          r="71.46"
          fx="45.259"
          fy="279.274"
          gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-c"
        />
        <radialGradient
          id="google-l"
          cx="304.017"
          cy="118.009"
          r="47.854"
          fx="304.017"
          fy="118.009"
          gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-d"
        />
        <radialGradient
          id="google-o"
          cx="181.001"
          cy="177.201"
          r="71.46"
          fx="181.001"
          fy="177.201"
          gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-e"
        />
        <radialGradient
          id="google-p"
          cx="207.673"
          cy="108.097"
          r="41.102"
          fx="207.673"
          fy="108.097"
          gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-f"
        />
        <radialGradient
          id="google-r"
          cx="109.627"
          cy="135.862"
          r="71.46"
          fx="109.627"
          fy="135.862"
          gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-g"
        />
        <radialGradient
          id="google-j"
          cx="154.87"
          cy="145.969"
          r="71.46"
          fx="154.87"
          fy="145.969"
          gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)"
          gradientUnits="userSpaceOnUse"
          xlinkHref="#google-h"
        />
        <filter
          id="google-q"
          width="1.097"
          height="1.116"
          x="-.048"
          y="-.058"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.701" />
        </filter>
        <filter
          id="google-k"
          width="1.033"
          height="1.02"
          x="-.017"
          y="-.01"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation=".242" />
        </filter>
        <clipPath id="google-i" clipPathUnits="userSpaceOnUse">
          <path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#google-i)" transform="matrix(.95792 0 0 .98525 -90.174 -78.856)">
        <path
          d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z"
          fill="url(#google-j)"
          filter="url(#google-k)"
        />
        <path
          d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z"
          fill="url(#google-l)"
          filter="url(#google-k)"
        />
        <path
          d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z"
          fill="url(#google-m)"
          filter="url(#google-k)"
        />
        <path
          d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z"
          fill="url(#google-n)"
          filter="url(#google-k)"
        />
        <path
          d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z"
          fill="#3086ff"
          filter="url(#google-k)"
        />
        <path
          d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z"
          fill="url(#google-o)"
          filter="url(#google-k)"
        />
        <path
          d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z"
          fill="url(#google-p)"
          filter="url(#google-q)"
        />
        <path
          d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z"
          fill="url(#google-r)"
          filter="url(#google-k)"
        />
        <path
          d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z"
          fill="url(#google-s)"
          filter="url(#google-k)"
          opacity=".5"
        />
      </g>
    </svg>
  );
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

      await navigate({
        search: toMailboxSearch({}),
        to: "/",
      });
    },
    mutationKey: ["auth", mode, "passkey"],
  });
  const passkeyMutation = useMutation(passkeyMutationOptions);

  const magicLinkMutationOptions = mutationOptions({
    mutationFn: async ({ email, name }: AuthFormValues) => {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();
      const status = await queryClient.fetchQuery(
        orpc.auth.getUserStatus.queryOptions({
          input: { email: normalizedEmail },
          staleTime: 0,
        }),
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
        orpc.auth.getEmailPreview.queryOptions({
          input: { email: normalizedEmail },
          staleTime: 0,
        }),
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
        <h1 className="text-3xl font-medium tracking-tight text-foreground">{pageTitle}</h1>

        <form
          action={async () => {
            await form.handleSubmit();
          }}
          className="mt-8 space-y-3"
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
          <GoogleLogo className="size-4 shrink-0" />
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
                    <a
                      className="mt-2 block break-all text-foreground underline"
                      href={activePreview.url}
                    >
                      {activePreview.url}
                    </a>
                  </div>
                ) : null}

                {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
              </>
            );
          }}
        </form.Subscribe>

        <p className="mt-6 text-sm text-muted-foreground">
          <Link className="text-foreground underline" search={toAuthSearch()} to={alternateHref}>
            {alternateLabel}
          </Link>
        </p>
      </div>
    </div>
  );
};
