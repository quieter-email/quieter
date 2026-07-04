import type { ReactElement } from "react";
import { serverEnv } from "@quieter/env/server";
import { render } from "@react-email/render";
import { MagicLinkEmail, VerificationEmail } from "./emails";

type AuthMailInput = {
  react: ReactElement;
  subject: string;
  text: string;
  to: string;
};

const SEND_API_PATH = "/api/v1/send";
const authMailSender = serverEnv.QUIETER_AUTH_MAIL_SENDER;
const shouldLogAuthMail = () =>
  serverEnv.QUIETER_AUTH_MAIL_MODE === "console" ||
  (serverEnv.NODE_ENV === "development" && !serverEnv.QUIETER_MAIL_API_KEY);

const parseSendError = async (response: Response) => {
  const body = await response
    .json()
    .then((value: unknown) =>
      typeof value === "object" && value !== null && "error" in value ? String(value.error) : null,
    )
    .catch(() => null);

  return body ?? `Quieter API returned ${response.status}.`;
};

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
  if (shouldLogAuthMail()) {
    console.info(
      [
        `Auth email for ${input.to}: ${input.subject}`,
        input.text,
        "Set QUIETER_MAIL_API_KEY to send through the configured mail API.",
      ].join("\n\n"),
    );
    return;
  }

  const apiKey = serverEnv.QUIETER_MAIL_API_KEY;

  if (!apiKey) {
    throw new Error("QUIETER_MAIL_API_KEY is required to send auth email.");
  }

  const response = await fetch(new URL(SEND_API_PATH, getAuthMailBaseUrl()), {
    body: JSON.stringify({
      from: authMailSender,
      html: await render(input.react),
      subject: input.subject,
      text: input.text,
      to: input.to,
    }),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Could not send auth email. Mail API returned ${response.status}: ${await parseSendError(
        response,
      )}`,
    );
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
