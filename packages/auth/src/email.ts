import type { ReactElement } from "react";
import { serverEnv } from "@quieter/env/server";
import { MagicLinkEmail, VerificationEmail } from "./emails";

type AuthMailInput = {
  react: ReactElement;
  subject: string;
  text: string;
  to: string;
};

const SEND_API_PATH = "/api/v1/send";
const authMailSender = serverEnv.QUIETER_AUTH_MAIL_SENDER;

const getAuthMailBaseUrl = () => {
  const configuredUrl = serverEnv.QUIETER_MAIL_API_URL;

  if (configuredUrl) {
    return getBaseUrlFromConfiguredMailUrl(configuredUrl);
  }

  return (
    serverEnv.BETTER_AUTH_URL ||
    (serverEnv.VERCEL_URL && `https://${serverEnv.VERCEL_URL}`) ||
    "http://localhost:3000"
  );
};

const getBaseUrlFromConfiguredMailUrl = (value: string) => {
  const url = new URL(value);
  const normalizedPath = url.pathname.replace(/\/+$/, "");

  if (normalizedPath.endsWith(SEND_API_PATH)) {
    url.pathname = normalizedPath.slice(0, -SEND_API_PATH.length) || "/";
    url.search = "";
    url.hash = "";
  }

  return url.href;
};

export const sendAuthMail = async (input: AuthMailInput) => {
  const apiKey = serverEnv.QUIETER_MAIL_API_KEY;

  if (!apiKey) {
    throw new Error("QUIETER_MAIL_API_KEY is required to send auth email.");
  }

  const { Quieter, QuieterApiError } = await import("quieter");
  const quieter = new Quieter({
    apiKey,
    baseUrl: getAuthMailBaseUrl(),
  });

  try {
    await quieter.send({
      from: authMailSender,
      react: input.react,
      subject: input.subject,
      text: input.text,
      to: input.to,
    });
  } catch (error) {
    if (error instanceof QuieterApiError) {
      throw new Error(
        `Could not send auth email. Mail API returned ${error.status}: ${error.message}`,
      );
    }

    throw error;
  }
};

export const sendVerificationEmail = async (input: { email: string; url: string }) => {
  await sendAuthMail({
    react: VerificationEmail({ url: input.url }),
    subject: "Verify your Quieter email",
    text: `Confirm this email address to finish setting up Quieter.\n\n${input.url}`,
    to: input.email,
  });
};

export const sendMagicLinkEmail = async (input: { email: string; url: string }) => {
  await sendAuthMail({
    react: MagicLinkEmail({ url: input.url }),
    subject: "Sign in to Quieter",
    text: `Use this link to sign in to Quieter.\n\n${input.url}`,
    to: input.email,
  });
};
