import { serverEnv } from "@quieter/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/internal/gmail-credentials/rotate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request.headers)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const { rotateLegacyGmailCredentials } =
            await import("@quieter/orpc/gmail-credential-rotation");
          return Response.json(await rotateLegacyGmailCredentials(), {
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          console.error(error);
          return Response.json({ error: "Credential rotation failed." }, { status: 500 });
        }
      },
    },
  },
});

const isAuthorized = (headers: Headers) => {
  const expectedToken = serverEnv.GMAIL_CREDENTIAL_ROTATION_TOKEN;
  const authorization = headers.get("authorization")?.trim();
  const providedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!expectedToken || !providedToken) {
    return false;
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
};
