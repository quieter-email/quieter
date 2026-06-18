import { chatMessage, db } from "@quieter/database";
import { eq } from "drizzle-orm";
import { getAuthorizedChatRun } from "./chat-run-store";
import {
  formatChatRunSse,
  isActiveChatRunStatus,
  subscribeChatRunEvents,
  type ChatRunStreamEvent,
} from "./chat-run-stream";
import { ensureChatRunGeneration, handoffChatRunToBackground } from "./chat/generation/lifecycle";

const getAssistantMessage = async (assistantMessageId: string) => {
  const [message] = await db
    .select({
      error: chatMessage.error,
      parts: chatMessage.parts,
      status: chatMessage.status,
    })
    .from(chatMessage)
    .where(eq(chatMessage.id, assistantMessageId))
    .limit(1);
  return message;
};

export const createChatRunStreamResponse = async (input: {
  requestSignal: AbortSignal;
  runId: string;
  userId: string;
}) => {
  const run = await getAuthorizedChatRun(input.runId, input.userId);

  if (!run) {
    return new Response("Unauthorized", { status: 401 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const encoder = new TextEncoder();
      const pendingEvents: ChatRunStreamEvent[] = [];
      let initialized = false;
      let finished = false;
      let resolveFinished = () => {};
      const finishedPromise = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });

      const send = (event: ChatRunStreamEvent) => {
        controller.enqueue(encoder.encode(formatChatRunSse(event)));

        if (event.type === "done") {
          finished = true;
          resolveFinished();
        }
      };

      const unsubscribe = subscribeChatRunEvents(input.runId, (event) => {
        if (initialized) {
          send(event);
        } else {
          pendingEvents.push(event);
        }
      });
      const onAbort = () => resolveFinished();
      input.requestSignal.addEventListener("abort", onAbort, { once: true });

      try {
        if (input.requestSignal.aborted) {
          resolveFinished();
          handoffChatRunToBackground(input.runId);
          return;
        }

        const latestRun = (await getAuthorizedChatRun(input.runId, input.userId)) ?? run;

        if (input.requestSignal.aborted) {
          handoffChatRunToBackground(input.runId);
          return;
        }

        const assistantMessage = await getAssistantMessage(latestRun.assistantMessageId);
        const assistantParts = assistantMessage?.parts ?? [{ content: "", type: "text" }];

        if (input.requestSignal.aborted) {
          handoffChatRunToBackground(input.runId);
          return;
        }

        if (!isActiveChatRunStatus(latestRun.status)) {
          send({
            assistantMessageId: latestRun.assistantMessageId,
            error: latestRun.error ?? assistantMessage?.error,
            parts: assistantParts,
            status: latestRun.status,
            type: "done",
          });
          return;
        }

        send({
          assistantMessageId: latestRun.assistantMessageId,
          parts: assistantParts,
          type: "draft",
        });
        initialized = true;

        for (const event of pendingEvents) {
          if (!finished) {
            send(event);
          }
        }

        if (!finished) {
          void ensureChatRunGeneration(input.runId);
          await finishedPromise;
        }

        if (input.requestSignal.aborted) {
          handoffChatRunToBackground(input.runId);
        }
      } finally {
        unsubscribe();
        input.requestSignal.removeEventListener("abort", onAbort);
        controller.close();
      }
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
