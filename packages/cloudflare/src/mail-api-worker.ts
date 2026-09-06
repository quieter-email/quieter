import { ORPCError } from "@orpc/server";
import {
  OrganizationApiKeyAuthorizationError,
  OrganizationApiKeyRateLimitError,
  verifyOrganizationApiKey,
} from "@quieter/auth/api-key-verification";
import { withRequestDatabaseClient } from "@quieter/database/client";
import { MailIdempotencyConflictError } from "@quieter/database/mail-acceptance";
import { MailAdmissionCapacityError } from "@quieter/database/mail-admission";
import { createMailApiEnv } from "@quieter/env/mail-api";
import { MAX_SEND_PAYLOAD_BYTES } from "@quieter/mail/send";
import type { MailSubmissionWake } from "@quieter/mail/submission-events";
import {
  acceptOrganizationMailSubmission,
  getOrganizationMailSubmission,
} from "@quieter/orpc/mail-submission-service";
import { OrganizationMailSendError } from "@quieter/orpc/organization-mail-policy";
import { z } from "zod";

import { withMailOperationDeadline } from "./mail-operation-deadline.ts";
import { R2SubmissionPayloadStorage } from "./submission-payload-storage.ts";
import { reportWorkerError, withSentryReporting } from "./worker-runtime.ts";

export type MailApiBindings = {
  QUIETER_MAIL_API_CONFIG?: string;
  MailSubmissionPayloads: R2Bucket;
  MailSubmissionWakeQueue: Pick<Queue<MailSubmissionWake>, "send">;
};

const readMessage = async (request: Request): Promise<unknown> => {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new OrganizationMailSendError(
      "Content-Type must be application/json.",
      415
    );
  }
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_SEND_PAYLOAD_BYTES)
  ) {
    throw new OrganizationMailSendError(
      "Submission exceeds the message size limit.",
      413
    );
  }
  if (request.body === null) {
    throw new OrganizationMailSendError("A JSON message is required.", 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // oxlint-disable-next-line promise/avoid-new -- Bound the entire streaming read, including clients that stop sending bytes.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new OrganizationMailSendError(
          "Message upload timed out. Retry with the same idempotency key.",
          408
        )
      );
    }, 10_000);
  });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- Read and bound each chunk before retaining it.
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) {
        break;
      }
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        throw new OrganizationMailSendError(
          "A valid UTF-8 JSON message is required.",
          400
        );
      }
      bytes += value.byteLength;
      if (bytes > MAX_SEND_PAYLOAD_BYTES) {
        throw new OrganizationMailSendError(
          "Submission exceeds the message size limit.",
          413
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof OrganizationMailSendError) {
      throw error;
    }
    throw new OrganizationMailSendError(
      "A valid UTF-8 JSON message is required.",
      400
    );
  } finally {
    clearTimeout(timer);
    // oxlint-disable-next-line promise/prefer-await-to-then -- Cancellation can wait on a stalled producer; do not extend the request deadline.
    void reader.cancel().catch(() => {
      /* The request already has its failure response. */
    });
    reader.releaseLock();
  }
};

export const handleMailApiRequest = async (
  request: Request,
  env: MailApiBindings,
  context: Pick<ExecutionContext, "waitUntil">
): Promise<Response> => {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  try {
    const path = new URL(request.url).pathname;
    const statusMatch = /^\/api\/v2\/messages\/(?<messageId>[^/]+)$/u.exec(
      path
    );
    if (path !== "/api/v2/send" && statusMatch === null) {
      return Response.json({ error: "Not found." }, { headers, status: 404 });
    }
    const method = statusMatch === null ? "POST" : "GET";
    if (request.method !== method) {
      headers.set("allow", method);
      return Response.json(
        { error: "Method not allowed." },
        { headers, status: 405 }
      );
    }
    const config = createMailApiEnv(env);
    if (
      config === null ||
      (statusMatch === null && !config.acceptanceEnabled)
    ) {
      headers.set("retry-after", "30");
      return Response.json(
        {
          error:
            "Message acceptance is temporarily unavailable. Retry with the same idempotency key.",
        },
        { headers, status: 503 }
      );
    }
    return await withRequestDatabaseClient(async (database) => {
      const identity = await verifyOrganizationApiKey(request);
      if (identity === null) {
        headers.set("www-authenticate", "Bearer");
        return Response.json(
          { error: "A valid API key is required." },
          { headers, status: 401 }
        );
      }
      if (!config.organizationIds.includes(identity.organizationId)) {
        return Response.json(
          { error: "This team does not have access to this API." },
          { headers, status: 403 }
        );
      }
      if (statusMatch !== null) {
        const parsed = z.uuid().safeParse(statusMatch.groups?.messageId);
        if (!parsed.success) {
          return Response.json(
            { error: "Not found." },
            { headers, status: 404 }
          );
        }
        const status = await getOrganizationMailSubmission(database, {
          identity,
          messageId: parsed.data,
        });
        return status === null
          ? Response.json({ error: "Not found." }, { headers, status: 404 })
          : Response.json(status, { headers });
      }
      const idempotencyKey = request.headers.get("idempotency-key") ?? "";
      if (!/^[\u0021-\u007E]{1,128}$/u.test(idempotencyKey)) {
        throw new OrganizationMailSendError(
          "A valid Idempotency-Key header is required.",
          400
        );
      }
      const message = await readMessage(request);
      const accepted = await acceptOrganizationMailSubmission(database, {
        idempotencyKey,
        identity,
        limits: config.limits,
        message,
        storage: new R2SubmissionPayloadStorage(env.MailSubmissionPayloads),
      });
      context.waitUntil(
        (async () => {
          try {
            await withMailOperationDeadline(
              env.MailSubmissionWakeQueue.send(
                { schemaVersion: 1, type: "submission.outbox-ready" },
                { contentType: "json" }
              )
            );
          } catch {
            reportWorkerError(
              new Error("Accepted mail requires scheduled outbox recovery."),
              { category: "mail_api_wakeup_failed", route: "send" }
            );
          }
        })()
      );
      headers.set("location", `/api/v2/messages/${accepted.result.messageId}`);
      return Response.json(accepted.result, {
        headers,
        status: accepted.replayed ? 200 : 201,
      });
    });
  } catch (error) {
    let status = 503;
    let message =
      "Mail is temporarily unavailable. Retry with the same idempotency key.";
    if (error instanceof OrganizationApiKeyAuthorizationError) {
      status = 401;
      message = "A valid API key is required.";
      headers.set("www-authenticate", "Bearer");
    } else if (error instanceof OrganizationApiKeyRateLimitError) {
      status = 429;
      ({ message } = error);
    } else if (error instanceof OrganizationMailSendError) {
      ({ status, message } = error);
    } else if (error instanceof MailIdempotencyConflictError) {
      status = 409;
      ({ message } = error);
    } else if (error instanceof MailAdmissionCapacityError) {
      ({ message } = error);
    } else if (error instanceof z.ZodError) {
      status = 400;
      message = "The message does not match the supported request format.";
    } else if (
      error instanceof ORPCError &&
      (error.code === "FORBIDDEN" || error.code === "TOO_MANY_REQUESTS")
    ) {
      ({ status, message } = error);
    } else {
      reportWorkerError(new Error("Mail API operation failed."), {
        category: "mail_api_unavailable",
        route: "mail-api",
      });
    }
    if (status === 503 || status === 429) {
      headers.set("retry-after", "30");
    }
    return Response.json({ error: message }, { headers, status });
  }
};

const handler = {
  fetch: handleMailApiRequest,
} satisfies ExportedHandler<MailApiBindings>;
export default withSentryReporting(handler);
