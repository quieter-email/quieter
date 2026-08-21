import { createFileRoute } from "@tanstack/react-router";

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

        // The validated prompt is capped at 10k characters; the transport body
        // carries one message, so this generous parse guard is plenty. The
        // browser transport always sends Content-Length; a missing or invalid
        // header cannot be size-checked, so it is rejected up front.
        const contentLengthHeader = request.headers.get("content-length");
        const contentLength = Number(contentLengthHeader);
        if (contentLengthHeader === null || Number.isNaN(contentLength)) {
          return new Response("Chat request length required.", { status: 411 });
        }
        if (contentLength > 1_000_000) {
          return new Response("Chat request body too large.", { status: 413 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid chat request body.", { status: 400 });
        }

        try {
          const { createAiChatResponse } = await import("@quieter/orpc/chat");
          return await createAiChatResponse({ body, request, userId });
        } catch (error) {
          const { ChatRequestError } = await import("@quieter/orpc/chat");
          if (error instanceof ChatRequestError) {
            return new Response(error.message, {
              status: error.status,
              statusText: error.message,
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
