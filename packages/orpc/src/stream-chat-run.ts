import { db } from "@quieter/database/client";
import { chatMessage } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { getAuthorizedChatRun } from "./chat-run-store";
import {
  formatChatRunSse,
  isActiveChatRunStatus,
  subscribeChatRunEvents,
  type ChatRunStreamEvent,
} from "./chat-run-stream";
import { getChatRunFailureMessage, terminalizeFailedChatRun } from "./chat/generation/failure";
import { startChatRun } from "./chat/generation/lifecycle";

const CHAT_RUN_POLL_INTERVAL_MS = 1_000;
const CHAT_RUN_STALE_HEARTBEAT_MS = 30_000;
const CHAT_RUN_KEEPALIVE_INTERVAL_MS = 15_000;

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
  const authorizedRun = await getAuthorizedChatRun(input.runId, input.userId);

  if (!authorizedRun) {
    return new Response("Unauthorized", { status: 401 });
  }

  let stopStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => stopStream(),
    start: (controller) => {
      const encoder = new TextEncoder();
      let closed = false;
      let polling = false;
      let previousParts = "";
      let previousStatus = authorizedRun.status;
      let lastRestartAt = 0;
      let pollInterval: ReturnType<typeof setInterval> | undefined;
      let keepaliveInterval: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = () => {};

      const cleanup = () => {
        if (pollInterval) clearInterval(pollInterval);
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        input.requestSignal.removeEventListener("abort", close);
        unsubscribe();
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();

        try {
          controller.close();
        } catch {
          // The browser may have already closed its side of the stream.
        }
      };
      const send = (event: ChatRunStreamEvent) => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(formatChatRunSse(event)));
        } catch {
          close();
          return;
        }

        if (event.type === "done") close();
      };
      const startGeneration = () => {
        void startChatRun(input.runId).catch(async (error) => {
          console.error(`Could not start chat generation ${input.runId}.`, error);
          await terminalizeFailedChatRun(input.runId, getChatRunFailureMessage(error)).catch(
            (terminalError) => {
              console.error("Could not close the chat run after startup failed.", terminalError);
            },
          );
        });
      };
      const poll = async () => {
        if (polling || closed || input.requestSignal.aborted) return;
        polling = true;

        try {
          const currentRun = await getAuthorizedChatRun(input.runId, input.userId);
          if (!currentRun) {
            close();
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
            return;
          }

          if (currentRun.status !== previousStatus) {
            previousStatus = currentRun.status;
            send({ status: currentRun.status, type: "status" });
          }

          if (serializedParts !== previousParts) {
            previousParts = serializedParts;
            send({
              assistantMessageId: currentRun.assistantMessageId,
              parts: currentParts,
              type: "draft",
            });
          }

          const lastActivity = currentRun.lastHeartbeatAt ?? currentRun.updatedAt;
          if (
            Date.now() - lastActivity.getTime() > CHAT_RUN_STALE_HEARTBEAT_MS &&
            Date.now() - lastRestartAt > CHAT_RUN_STALE_HEARTBEAT_MS
          ) {
            lastRestartAt = Date.now();
            startGeneration();
          }
        } catch (error) {
          console.error("Could not refresh the chat generation stream.", error);
        } finally {
          polling = false;
        }
      };

      stopStream = () => {
        if (closed) return;
        closed = true;
        cleanup();
      };
      input.requestSignal.addEventListener("abort", close, { once: true });
      unsubscribe = subscribeChatRunEvents(input.runId, send);
      keepaliveInterval = setInterval(() => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          close();
        }
      }, CHAT_RUN_KEEPALIVE_INTERVAL_MS);

      if (input.requestSignal.aborted) {
        close();
        return;
      }

      void (async () => {
        try {
          const latestRun =
            (await getAuthorizedChatRun(input.runId, input.userId)) ?? authorizedRun;
          const assistantMessage = await getAssistantMessage(latestRun.assistantMessageId);
          const assistantParts = assistantMessage?.parts ?? [{ content: "", type: "text" }];

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

          previousParts = JSON.stringify(assistantParts);
          previousStatus = latestRun.status;
          send({
            assistantMessageId: latestRun.assistantMessageId,
            parts: assistantParts,
            type: "draft",
          });
          send({ status: latestRun.status, type: "status" });
          startGeneration();
          pollInterval = setInterval(() => void poll(), CHAT_RUN_POLL_INTERVAL_MS);
          void poll();
        } catch (error) {
          console.error("Could not initialize the chat generation stream.", error);
          close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
};
