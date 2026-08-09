import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/runs/$runId/stream")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth } = await import("@quieter/auth");
        const session = await auth.api.getSession({ headers: request.headers });

        const userId = session?.user?.id;
        if (userId === undefined || userId === "") {
          return new Response("Unauthorized", { status: 401 });
        }

        const { createChatRunStreamResponse } =
          await import("@quieter/orpc/stream-chat-run");
        return await createChatRunStreamResponse({
          request,
          runId: params.runId,
          userId,
        });
      },
    },
  },
});
