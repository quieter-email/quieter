const normalizeEmail = (email: string | undefined): string | undefined => {
  const normalized = email?.trim().toLowerCase();
  return normalized?.includes("@") ? normalized : undefined;
};

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

const extractDomainFromEmail = (email: string | undefined): string | undefined => {
  if (!email) return undefined;
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) return undefined;

  return email
    .slice(atIndex + 1)
    .trim()
    .toLowerCase();
};

const getClampedAvatarSize = (requestedSize: number | undefined): number => {
  const size = requestedSize ?? 64;
  return Math.min(Math.max(size, 16), 256);
};

const getLogoDevPublishableKey = (): string => {
  const viteEnvToken = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const processEnvToken = processEnv?.env?.VITE_LOGO_DEV_PUBLISHABLE_KEY;

  return (viteEnvToken || processEnvToken || "").trim();
};

const getLogoDevAvatarUrl = (domain: string, size: number): string => {
  const token = getLogoDevPublishableKey();
  if (!token) return "";

  const url = new URL(`https://img.logo.dev/${encodeURIComponent(domain)}`);
  url.searchParams.set("token", token);
  url.searchParams.set("size", String(size));
  url.searchParams.set("fallback", "monogram");
  return url.toString();
};

const isPersonalMailboxDomain = (domain: string): boolean => PERSONAL_EMAIL_DOMAINS.has(domain);

const hashEmailForGravatar = async (email: string): Promise<string> => {
  const bytes = new TextEncoder().encode(email);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getGravatarAvatarUrl = async (
  email: string,
  size: number,
  fallbackUrl?: string,
): Promise<string> => {
  const hash = await hashEmailForGravatar(email);
  const url = new URL(`https://gravatar.com/avatar/${hash}`);
  url.searchParams.set("s", String(size));
  url.searchParams.set("r", "g");
  if (fallbackUrl) {
    url.searchParams.set("d", fallbackUrl);
  }
  return url.toString();
};

export const getDomainAvatarFallbackUrl = (
  email: string | undefined,
  opts?: { size?: number },
): string | undefined => {
  const domain = extractDomainFromEmail(email);
  if (!domain) return undefined;

  const size = getClampedAvatarSize(opts?.size);
  const url = getLogoDevAvatarUrl(domain, size);
  return url || undefined;
};

export const getSenderAvatarUrl = async (
  email: string | undefined,
  opts?: { size?: number },
): Promise<string | undefined> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return undefined;

  const domain = extractDomainFromEmail(normalizedEmail);
  if (!domain) return undefined;

  const size = getClampedAvatarSize(opts?.size);
  const logoDevUrl = getLogoDevAvatarUrl(domain, size);

  if (isPersonalMailboxDomain(domain)) {
    return await getGravatarAvatarUrl(normalizedEmail, size, logoDevUrl || undefined);
  }

  if (logoDevUrl) return logoDevUrl;

  return await getGravatarAvatarUrl(normalizedEmail, size);
};
