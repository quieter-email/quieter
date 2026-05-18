type AuthMailInput = {
  html?: string;
  subject: string;
  text: string;
  to: string;
};

const authMailSender = process.env.QUIETER_AUTH_MAIL_SENDER?.trim() || "auth@quieter.email";

const getAuthMailApiUrl = () => {
  const configuredUrl = process.env.QUIETER_MAIL_API_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  const baseUrl =
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
    "http://localhost:3000";

  return new URL("/api/messages", baseUrl).href;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const createLinkEmailHtml = (input: { body: string; cta: string; url: string }) => {
  const safeUrl = escapeHtml(input.url);

  return [
    `<p>${escapeHtml(input.body)}</p>`,
    `<p><a href="${safeUrl}">${escapeHtml(input.cta)}</a></p>`,
    `<p>If the link does not open, paste this URL into your browser:</p>`,
    `<p>${safeUrl}</p>`,
  ].join("\n");
};

export const sendAuthMail = async (input: AuthMailInput) => {
  const apiKey = process.env.QUIETER_MAIL_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("QUIETER_MAIL_API_KEY is required to send auth email.");
  }

  const response = await fetch(getAuthMailApiUrl(), {
    body: JSON.stringify({
      html: input.html,
      sender: authMailSender,
      subject: input.subject,
      text: input.text,
      to: [input.to],
    }),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getMailApiErrorMessage(response));
  }
};

const getMailApiErrorMessage = async (response: Response) => {
  const detail = await getMailApiErrorDetail(response);
  return [
    `Could not send auth email. Mail API returned ${response.status}`,
    response.statusText,
    detail,
  ]
    .filter(Boolean)
    .join(": ");
};

const getMailApiErrorDetail = async (response: Response) => {
  const body = await response.text();

  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : body;
  } catch {
    return body;
  }
};

export const sendVerificationEmail = async (input: { email: string; url: string }) => {
  await sendAuthMail({
    html: createLinkEmailHtml({
      body: "Confirm this email address to finish setting up Quieter.",
      cta: "Verify email",
      url: input.url,
    }),
    subject: "Verify your Quieter email",
    text: `Confirm this email address to finish setting up Quieter.\n\n${input.url}`,
    to: input.email,
  });
};

export const sendMagicLinkEmail = async (input: { email: string; url: string }) => {
  await sendAuthMail({
    html: createLinkEmailHtml({
      body: "Use this link to sign in to Quieter.",
      cta: "Sign in",
      url: input.url,
    }),
    subject: "Sign in to Quieter",
    text: `Use this link to sign in to Quieter.\n\n${input.url}`,
    to: input.email,
  });
};
