import { REQUIRED_GOOGLE_SCOPES } from "@quieter/auth/google-scopes";
import { authClient } from "~/lib/auth";

const PENDING_GMAIL_LINK_STORAGE_KEY = "quieter:pending-gmail-link";

export type PendingGmailLinkState = {
  mailboxCount: number;
  mailboxId?: string;
  mode: "connect" | "reconnect";
  startedAt: number;
};

export const readPendingGmailLink = (): PendingGmailLinkState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(PENDING_GMAIL_LINK_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      typeof parsedValue.mailboxCount !== "number" ||
      (parsedValue.mode !== "connect" && parsedValue.mode !== "reconnect") ||
      ("mailboxId" in parsedValue && typeof parsedValue.mailboxId !== "string") ||
      typeof parsedValue.startedAt !== "number"
    ) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
};

export const writePendingGmailLink = (value: PendingGmailLinkState | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!value) {
    window.sessionStorage.removeItem(PENDING_GMAIL_LINK_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_GMAIL_LINK_STORAGE_KEY, JSON.stringify(value));
};

export const openGoogleAccountLink = async (input: {
  callbackURL: string;
  errorCallbackURL?: string;
  loginHint?: string;
}) => {
  const response = await authClient.linkSocial({
    callbackURL: input.callbackURL,
    disableRedirect: true,
    errorCallbackURL: input.errorCallbackURL ?? input.callbackURL,
    provider: "google",
    scopes: [...REQUIRED_GOOGLE_SCOPES],
  });

  if (response.error) {
    throw new Error(response.error.message ?? "Could not start Google account linking.");
  }

  if (!response.data?.url) {
    throw new Error("Could not start Google account linking.");
  }

  const providerUrl = new URL(response.data.url);
  if (input.loginHint) {
    providerUrl.searchParams.set("login_hint", input.loginHint);
  }
  providerUrl.searchParams.set("prompt", "consent select_account");
  window.location.assign(providerUrl.toString());
};
