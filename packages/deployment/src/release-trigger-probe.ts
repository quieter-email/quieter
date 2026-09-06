import type {
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";
import { parseReleaseTriggerProbeBindings } from "@quieter/env/deployment";
import { z } from "zod";

const messageSchema = z.strictObject({ id: z.uuid() });

export default {
  async fetch(request: Request, bindings: unknown) {
    const env = parseReleaseTriggerProbeBindings(bindings);
    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response(null, { status: 404 });
    }
    const { pathname } = new URL(request.url);
    if (pathname === "/queue" && request.method === "POST") {
      const body = await request.text();
      if (body.length > 512) {
        return new Response(null, { status: 413 });
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(body);
      } catch {
        return new Response(null, { status: 400 });
      }
      const message = messageSchema.safeParse(decoded);
      if (!message.success) {
        return new Response(null, { status: 400 });
      }
      await env.PROBE_QUEUE.send(message.data);
      return new Response(null, { status: 202 });
    }
    if (request.method !== "GET") {
      return new Response(null, { status: 405 });
    }
    if (pathname === "/__release/health") {
      return Response.json(
        { checks: { ready: true }, versionId: env.PROBE_VERSION.id },
        { headers: { "cache-control": "no-store" } }
      );
    }
    const record =
      /^\/records\/(?<kind>queue|scheduled)\/(?<id>[a-f\d-]{36})$/u.exec(
        pathname
      );
    if (record?.groups !== undefined) {
      const value = await env.PROBE_RECORDS.get(
        `${record.groups.kind}/${record.groups.id}`
      );
      return value === null
        ? new Response(null, { status: 404 })
        : new Response(await value.text(), {
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json",
            },
          });
    }
    return new Response(null, { status: 404 });
  },
  async queue(batch: MessageBatch, bindings: unknown) {
    const env = parseReleaseTriggerProbeBindings(bindings);
    await Promise.all(
      batch.messages.map(async (message) => {
        const parsed = messageSchema.parse(message.body);
        await env.PROBE_RECORDS.put(
          `queue/${parsed.id}`,
          JSON.stringify({
            generation: env.PROBE_GENERATION,
            id: parsed.id,
            versionId: env.PROBE_VERSION.id,
          })
        );
        message.ack();
      })
    );
  },
  async scheduled(event: ScheduledController, bindings: unknown) {
    const env = parseReleaseTriggerProbeBindings(bindings);
    await env.PROBE_RECORDS.put(
      `scheduled/${env.PROBE_VERSION.id}`,
      JSON.stringify({
        generation: env.PROBE_GENERATION,
        scheduledTime: event.scheduledTime,
        versionId: env.PROBE_VERSION.id,
      })
    );
  },
};
