import { db, withRequestDatabaseClient } from "@quieter/database/client";
import { chatRun } from "@quieter/database/schema";
import { ensureChatRunGeneration } from "@quieter/orpc/chat-generation-lifecycle";
import { abortChatRun } from "@quieter/orpc/chat-generation-runtime";
import { isActiveChatRunStatus } from "@quieter/orpc/chat-run-store";
import {
  createChatRunHubSseResponse,
  createTerminalChatRunSseResponse,
  getChatRunHub,
  peekChatRunHub,
  releaseChatRunHub,
} from "@quieter/orpc/chat-stream-hub";
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { timingSafeEqual } from "./crypto-utils";

type ChatGenerationEnv = {
  ChatRunSession: DurableObjectNamespace;
  SST_RESOURCE_ChatGenerationStartToken: string;
};

const startPayloadSchema = z.object({
  runId: z.string().trim().min(1),
});

const textEncoder = new TextEncoder();

const readLinkedSecret = (value: string) =>
  z.object({ value: z.string().min(1) }).parse(JSON.parse(value)).value;

const signaturesMatch = async (actual: string, expected: string) => {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(actual)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected)),
  ]);
  return timingSafeEqual(actualDigest, expectedDigest);
};

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization")?.trim();
  if (
    authorization === undefined ||
    authorization === "" ||
    !authorization.toLowerCase().startsWith("bearer ")
  ) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token === "" ? null : token;
};

const assertStartToken = async (request: Request, env: ChatGenerationEnv) => {
  const token = getBearerToken(request);
  const expected = readLinkedSecret(env.SST_RESOURCE_ChatGenerationStartToken);
  if (token === null || !(await signaturesMatch(token, expected))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
};

const sessionStub = (env: ChatGenerationEnv, runId: string) => {
  const id = env.ChatRunSession.idFromName(runId);
  return env.ChatRunSession.get(id);
};

/**
 * One Durable Object per chat runId.
 * Owns the provider stream, in-memory dump-then-live hub, and cancel abort.
 */
export class ChatRunSession extends DurableObject<ChatGenerationEnv> {
  #generation: Promise<void> | null = null;

  #ensureProducer(runId: string, force: boolean) {
    if (this.#generation !== null) {
      return;
    }
    // A reclaimed run must not reuse the hub a dead producer left behind, and the fresh
    // hub has to exist before observers attach so they tail what this run appends to.
    releaseChatRunHub(runId);
    getChatRunHub(runId);
    const generation = (async () => {
      try {
        await withRequestDatabaseClient(async () => {
          await ensureChatRunGeneration(runId, { force });
        });
      } finally {
        this.#generation = null;
      }
    })();
    this.#generation = generation;
    this.ctx.waitUntil(generation);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId")?.trim();
    if (runId === undefined || runId === "") {
      return Response.json({ error: "runId required" }, { status: 400 });
    }

    if (request.method === "POST" && url.pathname === "/start") {
      this.#ensureProducer(runId, false);
      return Response.json({ runId, started: true });
    }

    if (request.method === "POST" && url.pathname === "/cancel") {
      abortChatRun(runId);
      return Response.json({ cancelled: true, runId });
    }

    if (request.method === "GET" && url.pathname === "/stream") {
      if (this.#generation !== null) {
        return createChatRunHubSseResponse(
          getChatRunHub(runId),
          request.signal
        );
      }

      return await withRequestDatabaseClient(async () => {
        const [run] = await db
          .select({
            error: chatRun.error,
            status: chatRun.status,
          })
          .from(chatRun)
          .where(eq(chatRun.id, runId))
          .limit(1);

        if (run === undefined) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        if (isActiveChatRunStatus(run.status)) {
          // DO restarted (or stream beat start): reclaim and resume the producer.
          // Attaching to the hub it left behind would tail a log nobody writes to.
          this.#ensureProducer(runId, true);
          return createChatRunHubSseResponse(
            getChatRunHub(runId),
            request.signal
          );
        }

        // Terminal run: replay the sealed hub so a late observer still gets the transcript.
        const sealed = peekChatRunHub(runId);
        if (sealed !== undefined && sealed !== null) {
          return createChatRunHubSseResponse(sealed, request.signal);
        }

        return createTerminalChatRunSseResponse({
          error: run.error,
          runId,
          status: run.status,
        });
      });
    }

    return new Response(null, { status: 404 });
  }
}

const forwardToSession = async (
  env: ChatGenerationEnv,
  runId: string,
  path: "/start" | "/cancel" | "/stream",
  request: Request
) => {
  const target = new URL(path, "https://chat-run.session");
  target.searchParams.set("runId", runId);
  return await sessionStub(env, runId).fetch(
    new Request(target.toString(), {
      headers: request.headers,
      method: request.method,
      signal: request.signal,
    })
  );
};

export default {
  async fetch(request: Request, env: ChatGenerationEnv) {
    const unauthorized = await assertStartToken(request, env);
    if (unauthorized !== null) {
      return unauthorized;
    }

    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/start")
    ) {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return Response.json(
          { error: "Invalid chat generation request." },
          { status: 400 }
        );
      }
      const parsed = startPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid chat generation request." },
          { status: 400 }
        );
      }
      return await forwardToSession(env, parsed.data.runId, "/start", request);
    }

    const streamMatch = /^\/runs\/(?<runId>[^/]+)\/stream$/u.exec(url.pathname);
    const streamRunId = streamMatch?.groups?.runId;
    if (
      request.method === "GET" &&
      streamRunId !== undefined &&
      streamRunId !== ""
    ) {
      return await forwardToSession(
        env,
        decodeURIComponent(streamRunId),
        "/stream",
        request
      );
    }

    const cancelMatch = /^\/runs\/(?<runId>[^/]+)\/cancel$/u.exec(url.pathname);
    const cancelRunId = cancelMatch?.groups?.runId;
    if (
      request.method === "POST" &&
      cancelRunId !== undefined &&
      cancelRunId !== ""
    ) {
      return await forwardToSession(
        env,
        decodeURIComponent(cancelRunId),
        "/cancel",
        request
      );
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<ChatGenerationEnv>;
