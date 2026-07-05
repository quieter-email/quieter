import { createFileRoute } from "@tanstack/react-router";
import {
  createPreviewPersonaClearHeaders,
  createPreviewPersonaSessionHeaders,
  isPreviewPersona,
  isPreviewPersonasEnabled,
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
          { headers: await createPreviewPersonaSessionHeaders(persona) },
        );
      },
      DELETE: async () => {
        if (!isPreviewPersonasEnabled()) {
          return Response.json({ error: "Preview personas are disabled." }, { status: 404 });
        }

        return Response.json({}, { headers: createPreviewPersonaClearHeaders() });
      },
    },
  },
});
