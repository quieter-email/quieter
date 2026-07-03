import { createFileRoute } from "@tanstack/react-router";
import {
  isPreviewPersona,
  isPreviewPersonasEnabled,
  previewPersonaCookieName,
} from "~/lib/preview-personas.server";

export const Route = createFileRoute("/api/preview-persona")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isPreviewPersonasEnabled()) {
          return Response.json({ error: "Preview personas are disabled." }, { status: 404 });
        }

        const body = await request.json().catch(() => null);
        const persona = body && typeof body === "object" && "persona" in body ? body.persona : null;

        if (!isPreviewPersona(persona)) {
          return Response.json({ error: "Unknown preview persona." }, { status: 400 });
        }

        return Response.json(
          { persona },
          {
            headers: {
              "cache-control": "no-store",
              "set-cookie": serializePreviewPersonaCookie(persona, request.url),
            },
          },
        );
      },
    },
  },
});

const serializePreviewPersonaCookie = (persona: string, requestUrl: string) => {
  const secureCookie = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";

  return [
    `${previewPersonaCookieName}=${encodeURIComponent(persona)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
    secureCookie,
  ]
    .filter(Boolean)
    .join("; ");
};
