import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";

import { getAuthorizedChatRun, isActiveChatRunStatus } from "./chat-run-store";
import { isChatRunProducerActive } from "./chat/generation/runtime";
import {
  createChatRunHubSseResponse,
  getChatRunHub,
  createTerminalChatRunSseResponse,
  peekChatRunHub,
  releaseChatRunHub,
} from "./chat/stream-hub";
import { hasText } from "./text";

/** Runs whose producer is hosted by a still-open observation request in this isolate. */
const localProducers = new Map<string, AbortSignal>();

/**
 * Start (or restart) a local producer hosted by this SSE request.
 *
 * Without a generation worker there is no Durable Object to own the run, so the
 * long-lived observation response is the only request whose lifetime covers the whole
 * generation. When that request goes away — reload, navigation — the run is handed back
 * with its draft, and the next observer picks it up rather than tailing a dead hub.
 */
const startLocalChatRunProducer = (runId: string, signal: AbortSignal) => {
  const host = localProducers.get(runId);
  const isHosted = host !== undefined && !host.aborted;
  // A dropped connection does not stop the producer it was hosting. Restarting on top of
  // a live one would fork the response, so ownership is confirmed before taking over.
  if (isHosted || isChatRunProducerActive(runId)) {
    return;
  }

  localProducers.set(runId, signal);
  // A dead producer's hub is never written to again; drop it before observers attach.
  releaseChatRunHub(runId);
  getChatRunHub(runId);

  const release = () => {
    if (localProducers.get(runId) === signal) {
      localProducers.delete(runId);
    }
  };

  void (async () => {
    try {
      // Deployed builds proxy to the generation worker, so the agent graph stays out of
      // this handler's bundle.
      const { ensureChatRunGeneration } =
        await import("./chat/generation/lifecycle");
      // Reclaiming is forced: only one isolate runs generations without a worker, and a
      // previous attempt's heartbeat can still look fresh when its host request was
      // cancelled rather than finished.
      //
      // The producer cannot outlive the request hosting it, so the run is stopped through
      // this signal: it requeues the run with its draft intact, and the next observer
      // resumes a clean run. Handing the signal down also covers an abort that lands
      // before the generation has a controller to cancel.
      await ensureChatRunGeneration(runId, { force: true, signal });
    } finally {
      release();
      signal.removeEventListener("abort", release);
    }
  })();
  signal.addEventListener("abort", release, { once: true });
};

const proxyChatRunStream = async (runId: string, request: Request) => {
  const startUrl = serverEnv.CHAT_GENERATION_START_URL;
  const token = serverEnv.CHAT_GENERATION_START_TOKEN;
  if (!hasText(startUrl) || !hasText(token)) {
    return createTerminalChatRunSseResponse({
      error: "Chat generation stream is not configured.",
      runId,
      status: "failed",
    });
  }

  const streamUrl = new URL(
    `/runs/${encodeURIComponent(runId)}/stream`,
    startUrl
  );
  try {
    const response = await fetch(streamUrl, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
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
 * SSE for an in-flight or finished chat run.
 * Local execution: host the producer here and dump-then-live from the in-process hub.
 * Deployed: proxy to the ChatRunSession Durable Object after auth.
 */
export const createChatRunStreamResponse = async (input: {
  request: Request;
  runId: string;
  userId: string;
}) =>
  await withRequestDatabaseClient(async () => {
    const authorizedRun = await getAuthorizedChatRun(input.runId, input.userId);

    if (authorizedRun === null) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (hasText(serverEnv.CHAT_GENERATION_START_URL)) {
      return await proxyChatRunStream(input.runId, input.request);
    }

    if (isActiveChatRunStatus(authorizedRun.status)) {
      startLocalChatRunProducer(input.runId, input.request.signal);
      return createChatRunHubSseResponse(
        getChatRunHub(input.runId),
        input.request.signal
      );
    }

    // Terminal run: replay the sealed hub so a late observer still gets the transcript.
    const existingHub = peekChatRunHub(input.runId);
    if (existingHub !== undefined) {
      return createChatRunHubSseResponse(existingHub, input.request.signal);
    }

    return createTerminalChatRunSseResponse({
      error: authorizedRun.error,
      runId: input.runId,
      status: authorizedRun.status,
    });
  });
