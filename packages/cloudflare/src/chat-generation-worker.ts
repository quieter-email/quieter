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
} from "@quieter/orpc/chat-stream-hub";
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

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
  return crypto.subtle.timingSafeEqual(actualDigest, expectedDigest);
};

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim() || null;
};

const assertStartToken = async (request: Request, env: ChatGenerationEnv) => {
  const token = getBearerToken(request);
  const expected = readLinkedSecret(env.SST_RESOURCE_ChatGenerationStartToken);
  if (!token || !(await signaturesMatch(token, expected))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: { "content-type": "application/json" },
      status: 401,
    });
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
    if (this.#generation) {
      return;
    }
    // Ensure observers can attach before the first token lands.
    getChatRunHub(runId);
    this.#generation = withRequestDatabaseClient(async () => {
      await ensureChatRunGeneration(runId, { force });
    }).finally(() => {
      this.#generation = null;
    });
    this.ctx.waitUntil(this.#generation);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId")?.trim();
    if (!runId) {
      return new Response(JSON.stringify({ error: "runId required" }), {
        headers: { "content-type": "application/json" },
        status: 400,
      });
    }

    if (request.method === "POST" && url.pathname === "/start") {
      this.#ensureProducer(runId, false);
      return new Response(JSON.stringify({ runId, started: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/cancel") {
      abortChatRun(runId);
      return new Response(JSON.stringify({ cancelled: true, runId }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/stream") {
      const existing = peekChatRunHub(runId);
      if (existing) {
        return createChatRunHubSseResponse(existing, request.signal);
      }
      if (this.#generation) {
        return createChatRunHubSseResponse(getChatRunHub(runId), request.signal);
      }

      return withRequestDatabaseClient(async () => {
        const [run] = await db
          .select({
            error: chatRun.error,
            status: chatRun.status,
          })
          .from(chatRun)
          .where(eq(chatRun.id, runId))
          .limit(1);

        if (!run) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            headers: { "content-type": "application/json" },
            status: 404,
          });
        }

        if (isActiveChatRunStatus(run.status)) {
          // DO restarted (or stream beat start): reclaim and resume the producer.
          this.#ensureProducer(runId, true);
          return createChatRunHubSseResponse(getChatRunHub(runId), request.signal);
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
  request: Request,
) => {
  const target = new URL(path, "https://chat-run.session");
  target.searchParams.set("runId", runId);
  return sessionStub(env, runId).fetch(
    new Request(target, {
      headers: request.headers,
      method: request.method,
      signal: request.signal,
    }),
  );
};

export default {
  async fetch(request: Request, env: ChatGenerationEnv) {
    const unauthorized = await assertStartToken(request, env);
    if (unauthorized) {
      return unauthorized;
    }

    const url = new URL(request.url);

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/start")) {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid chat generation request." }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      }
      const parsed = startPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid chat generation request." }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      }
      return forwardToSession(env, parsed.data.runId, "/start", request);
    }

    const streamMatch = url.pathname.match(/^\/runs\/([^/]+)\/stream$/);
    if (request.method === "GET" && streamMatch?.[1]) {
      return forwardToSession(env, decodeURIComponent(streamMatch[1]), "/stream", request);
    }

    const cancelMatch = url.pathname.match(/^\/runs\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch?.[1]) {
      return forwardToSession(env, decodeURIComponent(cancelMatch[1]), "/cancel", request);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<ChatGenerationEnv>;
