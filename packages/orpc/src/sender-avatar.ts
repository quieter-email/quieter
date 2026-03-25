const EMAIL_ADDRESS_PATTERN = /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "pm.me",
  "fastmail.com",
  "zoho.com",
]);

const getLogoDevPublishableKey = (): string => {
  return (
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ??
    process.env.VITE_LOGO_DEV_PUBLISHABLE_KEY ??
    ""
  ).trim();
};

const getClampedAvatarSize = (requestedSize: number | undefined): number => {
  const size = requestedSize ?? 64;
  return Math.min(Math.max(size, 16), 256);
};

export type ResolvedColorScheme = "light" | "dark";
export type SenderAvatarUrls = { light: string; dark: string };

export const extractSenderEmail = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const match = normalized.match(EMAIL_ADDRESS_PATTERN);
  return match?.[1]?.trim().toLowerCase();
};

export const extractDomainFromSender = (value: string | undefined): string | undefined => {
  const email = extractSenderEmail(value);
  if (!email) return undefined;

  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) return undefined;
  return email.slice(atIndex + 1);
};

const isPersonalMailboxDomain = (domain: string): boolean => PERSONAL_EMAIL_DOMAINS.has(domain);

const hashEmailForGravatar = async (email: string): Promise<string> => {
  const bytes = new TextEncoder().encode(email);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getGravatarAvatarUrl = async (email: string, size: number): Promise<string> => {
  const hash = await hashEmailForGravatar(email);
  const url = new URL(`https://gravatar.com/avatar/${hash}`);
  url.searchParams.set("s", String(size));
  url.searchParams.set("r", "g");
  // Missing personal avatars should fall back to the UI initial, not a remote default image.
  url.searchParams.set("d", "404");
  return url.toString();
};

const getLogoDevAvatarUrl = (domain: string, size: number, theme: ResolvedColorScheme): string => {
  const token = getLogoDevPublishableKey();
  if (!token) return "";

  const url = new URL(`https://img.logo.dev/${encodeURIComponent(domain)}`);
  url.searchParams.set("token", token);
  url.searchParams.set("size", String(size));
  url.searchParams.set("theme", theme);
  url.searchParams.set("format", "webp");
  url.searchParams.set("fallback", "404");
  return url.toString();
};

export const getSenderAvatarUrls = async (
  sender: string | undefined,
  opts?: { size?: number },
): Promise<SenderAvatarUrls | undefined> => {
  const email = extractSenderEmail(sender);
  if (!email) return undefined;

  const domain = extractDomainFromSender(sender);
  if (!domain) return undefined;

  const size = getClampedAvatarSize(opts?.size);

  if (isPersonalMailboxDomain(domain)) {
    const gravatarUrl = await getGravatarAvatarUrl(email, size);
    return { light: gravatarUrl, dark: gravatarUrl };
  }

  const light = getLogoDevAvatarUrl(domain, size, "light");
  const dark = getLogoDevAvatarUrl(domain, size, "dark");

  if (!light || !dark) return undefined;
  return { light, dark };
};
