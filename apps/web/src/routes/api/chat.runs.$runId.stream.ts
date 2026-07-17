import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/runs/$runId/stream")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth } = await import("@quieter/auth");
        const session = await auth.api.getSession({ headers: request.headers });

        if (!session?.user?.id) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { createChatRunStreamResponse } = await import("@quieter/orpc/stream-chat-run");
        return createChatRunStreamResponse({
          requestSignal: request.signal,
          runId: params.runId,
          userId: session.user.id,
        });
      },
    },
  },
});
