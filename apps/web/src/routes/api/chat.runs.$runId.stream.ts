import { auth } from "@quieter/auth";
import { createChatRunStreamResponse } from "@quieter/orpc/stream-chat-run";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/runs/$runId/stream")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });

        if (!session?.user?.id) {
          return new Response("Unauthorized", { status: 401 });
        }

        return createChatRunStreamResponse({
          requestSignal: request.signal,
          runId: params.runId,
          userId: session.user.id,
        });
      },
    },
  },
});
