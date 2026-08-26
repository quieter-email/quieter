import { createFileRoute } from "@tanstack/react-router";

import { openApiDocument } from "#/lib/openapi-document.server";

export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: () =>
        Response.json(openApiDocument, {
          headers: {
            "cache-control": "no-store",
          },
        }),
    },
  },
});
