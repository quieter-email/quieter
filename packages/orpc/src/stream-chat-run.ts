import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { getAuthorizedChatRun, isActiveChatRunStatus } from "./chat-run-store";
import {
  createChatRunHubSseResponse,
  createTerminalChatRunSseResponse,
  getChatRunHub,
  peekChatRunHub,
} from "./chat/stream-hub";

const proxyChatRunStream = async (runId: string, request: Request) => {
  const startUrl = serverEnv.CHAT_GENERATION_START_URL;
  const token = serverEnv.CHAT_GENERATION_START_TOKEN;
  if (!startUrl || !token) {
    return createTerminalChatRunSseResponse({
      error: "Chat generation stream is not configured.",
      runId,
      status: "failed",
    });
  }

  const streamUrl = new URL(`/runs/${encodeURIComponent(runId)}/stream`, startUrl);
  try {
    const response = await fetch(streamUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      },
      method: "GET",
      signal: request.signal,
    });
    if (!response.ok) {
      return createTerminalChatRunSseResponse({
        error: `Chat stream failed (${response.status}).`,
        runId,
        status: "failed",
      });
    }
    return response;
  } catch (error) {
    if (request.signal.aborted) {
      throw error;
    }
    return createTerminalChatRunSseResponse({
      error: "The response connection was interrupted.",
      runId,
      status: "failed",
    });
  }
};

/**
 * Observation-only SSE for an in-flight or finished chat run.
 * Local/review: dump-then-live from the in-process hub.
 * Deployed: proxy to the ChatRunSession Durable Object after auth.
 * Does not start generation — mutations own that.
 */
export const createChatRunStreamResponse = async (input: {
  request: Request;
  runId: string;
  userId: string;
}) =>
  withRequestDatabaseClient(async () => {
    const authorizedRun = await getAuthorizedChatRun(input.runId, input.userId);

    if (!authorizedRun) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (serverEnv.CHAT_GENERATION_START_URL) {
      return proxyChatRunStream(input.runId, input.request);
    }

    const existingHub = peekChatRunHub(input.runId);
    if (existingHub) {
      return createChatRunHubSseResponse(existingHub, input.request.signal);
    }

    if (isActiveChatRunStatus(authorizedRun.status)) {
      // Race: stream attached before the producer created the hub.
      return createChatRunHubSseResponse(getChatRunHub(input.runId), input.request.signal);
    }

    return createTerminalChatRunSseResponse({
      error: authorizedRun.error,
      runId: input.runId,
      status: authorizedRun.status,
    });
  });
