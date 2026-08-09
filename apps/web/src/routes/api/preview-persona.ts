import { createFileRoute } from "@tanstack/react-router";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const Route = createFileRoute("/api/preview-persona")({
  server: {
    handlers: {
      DELETE: async () => {
        const previewPersonas = await import("#/lib/preview-personas.server");

        if (!previewPersonas.isPreviewPersonasEnabled()) {
          return Response.json(
            { error: "Preview personas are disabled." },
            { status: 404 }
          );
        }

        return Response.json(
          {},
          { headers: previewPersonas.createPreviewPersonaClearHeaders() }
        );
      },
      POST: async ({ request }) => {
        const previewPersonas = await import("#/lib/preview-personas.server");

        if (!previewPersonas.isPreviewPersonasEnabled()) {
          return Response.json(
            { error: "Preview personas are disabled." },
            { status: 404 }
          );
        }

        const body: unknown = await request.json().catch(() => null);
        const persona =
          isRecord(body) && "persona" in body ? body.persona : null;

        if (!previewPersonas.isPreviewPersona(persona)) {
          return Response.json(
            { error: "Unknown preview persona." },
            { status: 400 }
          );
        }

        return Response.json(
          { persona },
          {
            headers:
              await previewPersonas.createPreviewPersonaSessionHeaders(persona),
          }
        );
      },
    },
  },
});
