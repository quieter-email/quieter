import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

import { readBoundedJson } from "./bounded-json";
import {
  GMAIL_JOB_BODY_LIMIT,
  GMAIL_PROCESSING_URL,
  gmailJobSchema,
  processGmailJob,
} from "./gmail-processing-job";
import type {
  GmailFreshWake,
  GmailProcessingEnv,
} from "./gmail-processing-job";
import { RequestError, requestErrorResponse } from "./request-error";
import { withSentryReporting } from "./worker-runtime";

export { GmailFreshExecutor } from "./gmail-fresh-executor";

const executorNames = ["fresh-v1-0", "fresh-v1-1", "fresh-v1-2", "fresh-v1-3"];
const deliveryKeySchema = z.string().min(1).max(256).optional();

const acceptFreshWake = async (
  env: Pick<Env, "GmailFreshExecutor">,
  wake: GmailFreshWake,
  deliveryKey = crypto.randomUUID()
) => {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deliveryKey))
  );
  const first = (hash[0] ?? 0) % executorNames.length;
  const names = Array.from(
    { length: Math.min(executorNames.length, Math.max(1, wake.count)) },
    (_, index) => executorNames[(first + index) % executorNames.length]
  );
  // Native local workerd does not implement jurisdiction restrictions.
  const namespace =
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
      ? env.GmailFreshExecutor
      : env.GmailFreshExecutor.jurisdiction("eu");
  const accepted = await Promise.allSettled(
    names.map(async (name) => {
      if (name === undefined) {
        throw new Error("Fresh executor slot is unavailable.");
      }
      await namespace.getByName(name, { locationHint: "weur" }).wake(wake);
    })
  );
  const failed = accepted.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
};

export default withSentryReporting({
  async fetch(
    request: Request,
    env: GmailProcessingEnv & Pick<Env, "GmailFreshExecutor">
  ) {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.pathname !== new URL(GMAIL_PROCESSING_URL).pathname ||
      url.search !== ""
    ) {
      return new Response(null, { status: 404 });
    }
    try {
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim() !==
        "application/json"
      ) {
        throw new RequestError(400, "gmail_processing_content_type_invalid");
      }
      const parsed = gmailJobSchema.safeParse(
        await readBoundedJson(request, GMAIL_JOB_BODY_LIMIT)
      );
      if (!parsed.success) {
        throw new RequestError(400, "gmail_processing_job_invalid");
      }
      const deliveryKey = deliveryKeySchema.safeParse(
        request.headers.get("x-quieter-delivery-key") ?? undefined
      );
      if (!deliveryKey.success) {
        throw new RequestError(400, "gmail_processing_delivery_key_invalid");
      }
      request.signal.throwIfAborted();
      let decision;
      if (
        "kind" in parsed.data &&
        parsed.data.kind === "work" &&
        parsed.data.priority === "fresh"
      ) {
        await acceptFreshWake(
          env,
          { count: 1, mailboxId: parsed.data.mailboxId, notBefore: Date.now() },
          deliveryKey.data
        );
        decision = { action: "ack" } as const;
      } else {
        decision = await processGmailJob(parsed.data, env, {
          onFreshWakeAccepted: async (wake) => {
            await acceptFreshWake(env, wake);
          },
        });
      }
      request.signal.throwIfAborted();
      const placement = request.headers.get("cf-placement");
      return Response.json(
        decision,
        placement !== null && /^(?:local|remote)-[A-Z]{3}$/u.test(placement)
          ? { headers: { "cf-placement": placement } }
          : undefined
      );
    } catch (error) {
      return requestErrorResponse(error, "gmail-processing");
    }
  },
} satisfies ExportedHandler<Env>);
