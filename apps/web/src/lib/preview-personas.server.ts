import "@tanstack/react-start/server-only";
import { serverEnv } from "@quieter/env/server";

export const previewPersonaCookieName = "quieter_preview_persona";
export const previewPersonas = ["gmail", "managed", "empty"] as const;

export type PreviewPersona = (typeof previewPersonas)[number];

type PreviewSessionUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
};

const previewPersonaUsers: Record<PreviewPersona, PreviewSessionUser> = {
  empty: {
    email: "empty.preview@quieter.email",
    emailVerified: true,
    id: "preview-empty-user",
    image: null,
    name: "Empty Preview",
  },
  gmail: {
    email: "gmail.preview@quieter.email",
    emailVerified: true,
    id: "preview-gmail-user",
    image: null,
    name: "Gmail Preview",
  },
  managed: {
    email: "managed.preview@quieter.email",
    emailVerified: true,
    id: "preview-managed-user",
    image: null,
    name: "Managed Mail Preview",
  },
};

export const isPreviewPersona = (value: unknown): value is PreviewPersona =>
  typeof value === "string" && previewPersonas.includes(value as PreviewPersona);

export const isPreviewPersonasEnabled = () =>
  serverEnv.NODE_ENV === "development" || serverEnv.QUIETER_PREVIEW_PERSONAS_ENABLED === true;

export const getPreviewPersonaUser = (request: Request) => {
  if (!isPreviewPersonasEnabled()) return null;

  const persona = parseCookieHeader(request.headers.get("cookie"))[previewPersonaCookieName];
  return isPreviewPersona(persona) ? previewPersonaUsers[persona] : null;
};

const parseCookieHeader = (cookieHeader: string | null) => {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();

    if (!name) {
      continue;
    }

    try {
      cookies[name] = decodeURIComponent(rawValue.join("=").trim());
    } catch {
      cookies[name] = rawValue.join("=").trim();
    }
  }

  return cookies;
};
