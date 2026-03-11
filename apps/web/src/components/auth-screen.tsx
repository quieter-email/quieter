"use client";

import { Key02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quietr/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { signIn } from "~/lib/auth";

type AuthMode = "login" | "signup";

type AuthScreenProps = {
  mode: AuthMode;
};

type PlaceholderPreview = {
  createdAt: number;
  email: string;
  token: string;
  type: "magic-link" | "verification";
  url: string;
};

type AuthUserStatus = {
  email: string;
  exists: boolean;
  hasGoogleAccount: boolean;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
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

export const AuthScreen = ({ mode }: AuthScreenProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = getAuthErrorLabel(searchParams.get("error"));
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(authError);
  const [isGooglePending, setIsGooglePending] = useState(false);
  const [isMagicLinkPending, setIsMagicLinkPending] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);
  const [preview, setPreview] = useState<PlaceholderPreview | null>(null);

  const isSignup = mode === "signup";
  const pageTitle = isSignup ? "Sign up" : "Log in";
  const pageAction = isSignup ? "Create with magic link" : "Send magic link";
  const alternateHref = isSignup ? "/login" : "/signup";
  const alternateLabel = isSignup ? "Log in" : "Sign up";

  const loadUserStatus = async (nextEmail: string) => {
    const statusResponse = await fetch(
      `/api/auth-user-status?email=${encodeURIComponent(nextEmail.trim().toLowerCase())}`,
      {
        cache: "no-store",
      },
    );

    if (!statusResponse.ok) {
      throw new Error("Could not check that email.");
    }

    return (await statusResponse.json()) as AuthUserStatus;
  };

  const loadPreview = async (nextEmail: string) => {
    const previewResponse = await fetch(
      `/api/auth-email-preview?email=${encodeURIComponent(nextEmail.trim().toLowerCase())}`,
      {
        cache: "no-store",
      },
    );

    if (!previewResponse.ok) {
      setPreview(null);
      return;
    }

    const nextPreview = (await previewResponse.json()) as PlaceholderPreview;
    setPreview(nextPreview);
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsGooglePending(true);

    try {
      await signIn.social({
        provider: "google",
        callbackURL: "/",
      });
    } catch (signInError) {
      setError(getErrorMessage(signInError, "Could not start Google sign-in."));
    } finally {
      setIsGooglePending(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError(null);
    setIsPasskeyPending(true);

    try {
      const response = await signIn.passkey();

      if (response?.error) {
        throw new Error(getErrorMessage(response.error, "Could not sign in with a passkey."));
      }

      router.push("/");
    } catch (signInError) {
      setError(getErrorMessage(signInError, "Could not sign in with a passkey."));
    } finally {
      setIsPasskeyPending(false);
    }
  };

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPreview(null);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (trimmedEmail.length === 0) {
      setError("Email is required.");
      return;
    }

    if (isSignup && trimmedName.length === 0) {
      setError("Name is required.");
      return;
    }

    setIsMagicLinkPending(true);

    try {
      const status = await loadUserStatus(trimmedEmail);

      if (isSignup && status.exists) {
        throw new Error("That email already has an account.");
      }

      if (!isSignup && !status.exists) {
        throw new Error("That email needs to sign up first.");
      }

      const response = await signIn.magicLink({
        callbackURL: "/",
        email: trimmedEmail,
        errorCallbackURL: isSignup ? "/signup" : "/login",
        name: isSignup ? trimmedName : undefined,
        newUserCallbackURL: "/",
      });

      if (response && typeof response === "object" && "error" in response && response.error) {
        throw new Error(getErrorMessage(response.error, "Could not create a magic link."));
      }

      await loadPreview(trimmedEmail);
    } catch (magicLinkError) {
      setError(getErrorMessage(magicLinkError, "Could not create a magic link."));
    } finally {
      setIsMagicLinkPending(false);
    }
  };

  return (
    <div className="grid min-h-dvh w-full place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <div className="space-y-2">
          <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">Quietr</p>
          <h1 className="text-3xl font-medium tracking-tight text-foreground-dark">{pageTitle}</h1>
        </div>

        <form className="mt-8 space-y-3" onSubmit={handleMagicLink}>
          {isSignup ? (
            <TextField>
              <TextFieldInput
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
                value={name}
              />
            </TextField>
          ) : null}

          <TextField>
            <TextFieldInput
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              type="email"
              value={email}
            />
          </TextField>

          <Button
            className="w-full justify-center gap-3"
            disabled={isMagicLinkPending}
            type="submit"
          >
            {isMagicLinkPending ? (
              "Sending..."
            ) : (
              <>
                <HugeiconsIcon className="size-4 shrink-0" icon={Mail01Icon} />
                {pageAction}
              </>
            )}
          </Button>
        </form>

        <Button
          className="mt-3 w-full justify-center gap-3"
          disabled={isGooglePending}
          onClick={() => void handleGoogleSignIn()}
          variant="outline"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={Mail01Icon} />
          {isSignup ? "Continue with Google" : "Google"}
        </Button>

        <Button
          className="mt-3 w-full justify-center gap-3"
          disabled={isPasskeyPending}
          onClick={() => void handlePasskeySignIn()}
          variant="outline"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={Key02Icon} />
          Continue with passkey
        </Button>

        {preview ? (
          <div className="mt-4 rounded-md border border-border px-3 py-3 text-sm">
            <p className="text-muted-foreground">Placeholder link</p>
            <Link className="mt-2 block break-all text-foreground underline" href={preview.url}>
              {preview.url}
            </Link>
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <p className="mt-6 text-sm text-muted-foreground">
          <Link className="text-foreground underline" href={alternateHref}>
            {alternateLabel}
          </Link>
        </p>
      </div>
    </div>
  );
};
