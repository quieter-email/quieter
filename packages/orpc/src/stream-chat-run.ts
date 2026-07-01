import { db } from "@quieter/database/client";
import { chatMessage } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { getAuthorizedChatRun } from "./chat-run-store";
import {
  formatChatRunSse,
  isActiveChatRunStatus,
  type ChatRunStreamEvent,
} from "./chat-run-stream";
import { enqueueChatRun, handoffChatRunToBackground } from "./chat/generation/lifecycle";

const CHAT_RUN_POLL_INTERVAL_MS = 1_000;
const CHAT_RUN_STALE_HEARTBEAT_MS = 30_000;

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
      let finished = false;
      let polling = false;
      let previousParts = "";
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

      const onAbort = () => resolveFinished();
      input.requestSignal.addEventListener("abort", onAbort, { once: true });
      let pollInterval: ReturnType<typeof setInterval> | undefined;

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
        previousParts = JSON.stringify(assistantParts);

        const poll = async () => {
          if (polling || finished || input.requestSignal.aborted) return;
          polling = true;

          try {
            const currentRun = await getAuthorizedChatRun(input.runId, input.userId);
            if (!currentRun) {
              resolveFinished();
              return;
            }

            const currentAssistant = await getAssistantMessage(currentRun.assistantMessageId);
            const currentParts = currentAssistant?.parts ?? [{ content: "", type: "text" }];
            const serializedParts = JSON.stringify(currentParts);

            if (!isActiveChatRunStatus(currentRun.status)) {
              send({
                assistantMessageId: currentRun.assistantMessageId,
                error: currentRun.error ?? currentAssistant?.error,
                parts: currentParts,
                status: currentRun.status,
                type: "done",
              });
            } else {
              const lastActivity = currentRun.lastHeartbeatAt ?? currentRun.updatedAt;
              if (Date.now() - lastActivity.getTime() > CHAT_RUN_STALE_HEARTBEAT_MS) {
                await enqueueChatRun(input.runId);
              }

              if (serializedParts !== previousParts) {
                previousParts = serializedParts;
                send({
                  assistantMessageId: currentRun.assistantMessageId,
                  parts: currentParts,
                  type: "draft",
                });
              }
            }
          } catch (error) {
            console.error("Could not refresh the chat generation stream.", error);
          } finally {
            polling = false;
          }
        };

        if (!finished) {
          await enqueueChatRun(input.runId);
          pollInterval = setInterval(() => void poll(), CHAT_RUN_POLL_INTERVAL_MS);
          void poll();
          await finishedPromise;
        }

        if (input.requestSignal.aborted) {
          handoffChatRunToBackground(input.runId);
        }
      } finally {
        if (pollInterval) clearInterval(pollInterval);
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
