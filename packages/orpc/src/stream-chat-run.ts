import { withRequestDatabaseClient } from "@quieter/database/client";
import { resumeServerSentEventsResponse } from "@tanstack/ai";
import { getAuthorizedChatRun } from "./chat-run-store";
import {
  createPostgresStreamDurability,
  sanitizeChatRunStreamOffset,
} from "./chat/stream-durability";

/**
 * Observation-only SSE for an in-flight or finished chat run.
 * Replays TanStack AI StreamChunks from the Postgres durability log.
 * Does not start generation — mutations own that.
 */
export const createChatRunStreamResponse = async (input: {
  request: Request;
  runId: string;
  userId: string;
}) =>
  withRequestDatabaseClient(async (client) => {
    const authorizedRun = await getAuthorizedChatRun(input.runId, input.userId);

    if (!authorizedRun) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(input.request.url);
    const rawOffset = input.request.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
    const offset = sanitizeChatRunStreamOffset(input.runId, rawOffset);

    url.searchParams.set("runId", input.runId);
    url.searchParams.set("offset", offset);

    const headers = new Headers(input.request.headers);
    headers.set("X-Run-Id", input.runId);
    if (offset === "-1") {
      headers.delete("Last-Event-ID");
    } else {
      headers.set("Last-Event-ID", offset);
    }

    const resumeRequest = new Request(url, {
      headers,
      method: "GET",
      signal: input.request.signal,
    });

    return resumeServerSentEventsResponse({
      adapter: createPostgresStreamDurability(resumeRequest, { client }),
    });
  });
