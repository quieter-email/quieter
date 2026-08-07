import { resumeServerSentEventsResponse } from "@tanstack/ai";
import { getAuthorizedChatRun } from "./chat-run-store";
import { createPostgresStreamDurability } from "./chat/stream-durability";

/**
 * Observation-only SSE for an in-flight or finished chat run.
 * Replays TanStack AI StreamChunks from the Postgres durability log.
 * Does not start generation — mutations own that.
 */
export const createChatRunStreamResponse = async (input: {
  request: Request;
  runId: string;
  userId: string;
}) => {
  const authorizedRun = await getAuthorizedChatRun(input.runId, input.userId);

  if (!authorizedRun) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(input.request.url);
  if (!url.searchParams.get("runId")) {
    url.searchParams.set("runId", input.runId);
  }
  if (!url.searchParams.get("offset") && !input.request.headers.get("Last-Event-ID")) {
    url.searchParams.set("offset", "-1");
  }

  const headers = new Headers(input.request.headers);
  headers.set("X-Run-Id", input.runId);

  const resumeRequest = new Request(url, {
    headers,
    method: "GET",
    signal: input.request.signal,
  });

  return resumeServerSentEventsResponse({
    adapter: createPostgresStreamDurability(resumeRequest),
  });
};
