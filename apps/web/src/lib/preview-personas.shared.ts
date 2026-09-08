const previewPersonaCookieMaxAgeSeconds = 60 * 60 * 24 * 7;
export const previewPersonaCookieMaxAgeMs =
  previewPersonaCookieMaxAgeSeconds * 1000;
const previewPersonas = ["gmail", "managed", "empty"] as const;

export type PreviewPersona = (typeof previewPersonas)[number];

export const isPreviewPersona = (value: unknown): value is PreviewPersona => {
  if (typeof value !== "string") {
    return false;
  }
  return previewPersonas.some((persona) => persona === value);
};
