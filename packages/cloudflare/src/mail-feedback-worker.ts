import { createHash, timingSafeEqual } from "node:crypto";

import { withRequestDatabaseClient } from "@quieter/database/client";
import { retainMailFeedback } from "@quieter/database/mail-feedback-inbox";
import { createMailFeedbackEnv } from "@quieter/env/mail-feedback";
import {
  feedbackBridgeEnvelopeSchema,
  readFeedbackBridgeBody,
} from "@quieter/mail/feedback-bridge";
import {
  applyMailSubmissionFeedback,
  recoverMailSubmissionFeedback,
} from "@quieter/orpc/mail-submission-feedback";

import { reportWorkerError, withSentryReporting } from "./worker-runtime.ts";

type MailFeedbackBindings = {
  SENTRY_ENVIRONMENT?: string;
  QUIETER_MAIL_FEEDBACK_CONFIG?: string;
  SST_RESOURCE_App?: string;
  SST_RESOURCE_MailFeedbackBridgeToken?: string;
};

export const handleMailFeedbackRequest = async (
  request: Request,
  env: MailFeedbackBindings,
  context: Pick<ExecutionContext, "waitUntil">
): Promise<Response> => {
  const headers = { "cache-control": "no-store" };
  if (new URL(request.url).pathname !== "/internal/mail/feedback") {
    return new Response(null, { headers, status: 404 });
  }
  if (request.method !== "POST") {
    return new Response(null, {
      headers: { ...headers, allow: "POST" },
      status: 405,
    });
  }
  let config;
  try {
    config = createMailFeedbackEnv(env);
  } catch {
    reportWorkerError(new Error("Mail feedback configuration failed."), {
      category: "mail_feedback_configuration_failed",
      route: "feedback",
    });
    return new Response(null, { headers, status: 503 });
  }
  if (config === null) {
    return new Response(null, { headers, status: 503 });
  }
  if (
    !timingSafeEqual(
      createHash("sha256")
        .update(request.headers.get("authorization") ?? "")
        .digest(),
      createHash("sha256").update(`Bearer ${config.token}`).digest()
    )
  ) {
    return new Response(null, { headers, status: 401 });
  }
  if (
    request.headers.get("x-quieter-feedback-version") !== "1" ||
    request.headers.get("content-type") !== "application/json"
  ) {
    return new Response(null, { headers, status: 400 });
  }
  let envelope;
  try {
    envelope = feedbackBridgeEnvelopeSchema.parse(
      JSON.parse(await readFeedbackBridgeBody(request.body, 128 * 1024))
    );
    if (envelope.TopicArn !== config.topicArn) {
      return new Response(null, { headers, status: 403 });
    }
  } catch {
    return new Response(null, { headers, status: 400 });
  }
  const { region, topicArn } = config;
  try {
    const retained = await withRequestDatabaseClient(
      async (database) =>
        await retainMailFeedback(database, {
          payload: envelope,
          providerEventId: envelope.MessageId,
          providerMessageId: null,
          region,
          schemaVersion: 1,
          source: topicArn,
        })
    );
    context.waitUntil(
      (async () => {
        try {
          const result = await withRequestDatabaseClient(
            async (database) =>
              await applyMailSubmissionFeedback(database, {
                expectedSource: topicArn,
                inboxId: retained.id,
                region,
              })
          );
          if (result === "quarantined") {
            reportWorkerError(
              new Error("Mail feedback requires quarantine review."),
              { category: "mail_feedback_quarantined", route: "feedback" }
            );
          }
        } catch {
          reportWorkerError(
            new Error("Mail feedback requires scheduled recovery."),
            { category: "mail_feedback_processing_failed", route: "feedback" }
          );
        }
      })()
    );
    return Response.json(
      { eventId: envelope.MessageId, schemaVersion: 1, status: "retained" },
      { headers, status: retained.replayed ? 200 : 201 }
    );
  } catch {
    reportWorkerError(new Error("Mail feedback retention failed."), {
      category: "mail_feedback_retention_failed",
      route: "feedback",
    });
    return new Response(null, { headers, status: 503 });
  }
};

export const mailFeedbackHandler = {
  fetch: handleMailFeedbackRequest,
  async scheduled(_event, env) {
    try {
      const config = createMailFeedbackEnv(env);
      if (config === null) {
        return;
      }
      const result = await withRequestDatabaseClient(
        async (database) =>
          await recoverMailSubmissionFeedback(database, {
            expectedSource: config.topicArn,
            limit: 5,
            owner: crypto.randomUUID(),
            region: config.region,
          })
      );
      if (result.quarantined > 0) {
        reportWorkerError(
          new Error("Mail feedback requires quarantine review."),
          { category: "mail_feedback_quarantined", route: "scheduled" }
        );
      }
      if (result.deferred > 0) {
        throw new Error("Mail feedback recovery was deferred.");
      }
    } catch {
      const error = new Error("Mail feedback recovery failed.");
      reportWorkerError(error, {
        category: "mail_feedback_recovery_failed",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<MailFeedbackBindings>;

export default withSentryReporting({ ...mailFeedbackHandler });
