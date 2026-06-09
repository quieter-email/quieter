import { chatMessage, db, type ChatMessagePart } from "@quieter/database";
import { eq } from "drizzle-orm";
import {
  ensureChatRunGeneration,
  getAuthorizedChatRun,
  handoffChatRunToBackground,
} from "./chat-generation";
import { formatChatRunSse, waitForChatRunStream, type ChatRunStreamEvent } from "./chat-run-stream";

const ACTIVE_CHAT_RUN_STATUSES = new Set(["queued", "running", "waiting_on_tool"]);

export const createChatRunStreamResponse = async (input: {
  requestSignal: AbortSignal;
  runId: string;
  userId: string;
}) => {
  const run = await getAuthorizedChatRun(input.runId, input.userId);

  if (!run) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [assistantMessage] = await db
    .select({
      error: chatMessage.error,
      parts: chatMessage.parts,
      status: chatMessage.status,
    })
    .from(chatMessage)
    .where(eq(chatMessage.id, run.assistantMessageId))
    .limit(1);

  const assistantParts = (assistantMessage?.parts ?? [
    { content: "", type: "text" },
  ]) as ChatMessagePart[];

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const encoder = new TextEncoder();

      const send = (event: ChatRunStreamEvent) => {
        controller.enqueue(encoder.encode(formatChatRunSse(event)));
      };

      if (!ACTIVE_CHAT_RUN_STATUSES.has(run.status)) {
        send({
          assistantMessageId: run.assistantMessageId,
          error: run.error,
          parts: assistantParts,
          status: run.status,
          type: "done",
        });
        controller.close();
        return;
      }

      send({
        assistantMessageId: run.assistantMessageId,
        parts: assistantParts,
        type: "draft",
      });

      void ensureChatRunGeneration(input.runId);

      await waitForChatRunStream(input.runId, send, input.requestSignal);

      if (input.requestSignal.aborted) {
        handoffChatRunToBackground(input.runId);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
};
