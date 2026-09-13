import * as Sentry from "@sentry/cloudflare";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

describe("Sentry Worker lifetime", () => {
  test("delivers an exception captured after a streaming response starts", async () => {
    const envelopes: unknown[] = [];
    const { promise: streamReady, resolve: releaseStream } =
      Promise.withResolvers<null>();
    const error = new Error("Deferred stream failure");
    const worker = Sentry.withSentry<Env>(
      () => ({
        dsn: "https://public@example.ingest.sentry.io/1",
        tracesSampleRate: 0,
        transport: () => ({
          flush: async () => Promise.resolve(true),
          send: async (envelope) => {
            envelopes.push(envelope);
            return Promise.resolve({ statusCode: 200 });
          },
        }),
      }),
      {
        fetch() {
          const body = new ReadableStream({
            async start(controller) {
              await streamReady;
              Sentry.captureException(error, {
                tags: { operation: "chat:stream" },
              });
              controller.enqueue(new TextEncoder().encode("done"));
              controller.close();
            },
          });
          return new Response(body, {
            headers: { "content-type": "text/event-stream" },
          });
        },
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch?.(
      new Request("https://worker.invalid/api/chat"),
      env,
      context
    );
    if (response === undefined) {
      throw new Error("Expected a Worker response.");
    }

    expect(envelopes).toHaveLength(0);
    releaseStream(null);
    await expect(response.text()).resolves.toBe("done");
    await waitOnExecutionContext(context);

    expect(envelopes).toHaveLength(1);
    expect(JSON.stringify(envelopes[0])).toContain("Deferred stream failure");
    expect(JSON.stringify(envelopes[0])).toContain("chat:stream");
  });
});
