export const previewPersonaCookieName = "quieter_preview_persona";
export const previewPersonaCookieMaxAgeSeconds = 60 * 60 * 24 * 7;
export const previewPersonaCookieMaxAgeMs = previewPersonaCookieMaxAgeSeconds * 1000;
export const previewPersonas = ["gmail", "managed", "empty"] as const;

export type PreviewPersona = (typeof previewPersonas)[number];

export const isPreviewPersona = (value: unknown): value is PreviewPersona =>
  typeof value === "string" && previewPersonas.includes(value as PreviewPersona);
