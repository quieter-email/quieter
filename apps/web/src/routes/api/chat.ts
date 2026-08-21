import { chatParamsFromRequestBody } from "@tanstack/ai";
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

        // The validated prompt is capped at 10k characters; the transcript the
        // client resends stays well under this generous parse guard.
        const contentLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
          return new Response("Chat request body too large.", { status: 413 });
        }

        let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
        try {
          params = await chatParamsFromRequestBody(await request.json());
        } catch {
          return new Response("Invalid AG-UI request body.", { status: 400 });
        }

        try {
          const { createAiChatResponse } = await import("@quieter/orpc/chat");
          return await createAiChatResponse({ params, request, userId });
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
