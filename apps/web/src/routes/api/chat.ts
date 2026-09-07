import { createFileRoute } from "@tanstack/react-router";

import {
  LimitedJsonRequestError,
  readLimitedJsonRequest,
} from "#/lib/limited-json-request.server";

const MAX_CHAT_REQUEST_BYTES = 1_000_000;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { auth } = await import("@quieter/auth");
        const session = await auth.api.getSession({ headers: request.headers });
        const userId = session?.user?.id;
        if (userId === undefined || userId === "") {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: unknown;
        try {
          body = await readLimitedJsonRequest(request, MAX_CHAT_REQUEST_BYTES);
        } catch (error) {
          if (error instanceof LimitedJsonRequestError) {
            return new Response(error.message, { status: error.status });
          }
          throw error;
        }

        const { ChatRequestError, createAiChatResponse } =
          await import("@quieter/orpc/chat");
        try {
          return await createAiChatResponse({ body, request, userId });
        } catch (error) {
          if (error instanceof ChatRequestError) {
            return new Response(error.message, {
              status: error.status,
            });
          }
          const { reportError } = await import("@quieter/observability");
          reportError(error, { operation: "api:chat" });
          return new Response("AI chat is temporarily unavailable.", {
            status: 500,
          });
        }
      },
    },
  },
});
