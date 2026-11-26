import { withRequestDatabaseClient } from "@quieter/database/client";

import { readBoundedJson } from "./bounded-json";
import { executeGmailMailboxDispatch } from "./gmail-mailbox-executor";
import { gmailMailboxScheduler } from "./gmail-mailbox-scheduler";
import {
  GMAIL_JOB_BODY_LIMIT,
  GMAIL_PROCESSING_URL,
  gmailJobSchema,
} from "./gmail-processing-job";
import type { GmailJob } from "./gmail-processing-job";
import { RequestError, requestErrorResponse } from "./request-error";
import { withSentryReporting } from "./worker-runtime";

export { GmailFreshExecutor } from "./gmail-fresh-executor";
export { GmailMailboxScheduler } from "./gmail-mailbox-scheduler";
export { GmailProjectQuota } from "./gmail-project-quota";

const acceptGmailJob = async (job: GmailJob, env: Env) => {
  const now = Date.now();
  if ("kind" in job && job.kind === "dispatch-wake") {
    await gmailMailboxScheduler(env, job.mailboxId).wake(
      job.mailboxId,
      Object.fromEntries(job.tasks.map((task) => [task, job.dueAt ?? now]))
    );
    return;
  }
  if ("kind" in job && job.kind === "work") {
    await gmailMailboxScheduler(env, job.mailboxId).wake(job.mailboxId, {
      [job.priority]: job.notBefore ?? now,
    });
    return;
  }
  if ("kind" in job && job.kind === "automation") {
    await gmailMailboxScheduler(env, job.mailboxId).wake(
      job.mailboxId,
      Object.fromEntries(job.tasks.map((task) => [task, now]))
    );
    return;
  }
  if ("kind" in job && job.kind === "maintain") {
    await gmailMailboxScheduler(env, job.mailboxId).wake(job.mailboxId, {
      sync: now,
    });
    return;
  }
  const notification = "kind" in job ? job.notification : job;
  const { findConnectedGmailMailbox } =
    await import("@quieter/orpc/gmail-pubsub");
  const account = await withRequestDatabaseClient(
    async () => await findConnectedGmailMailbox(notification.emailAddress)
  );
  if (account !== null) {
    await gmailMailboxScheduler(env, account.id).wake(
      account.id,
      { ...("kind" in job ? {} : { discover: now }), sync: now },
      "kind" in job
        ? undefined
        : {
            notificationReceivedAt: notification.notificationReceivedAt ?? now,
            observedHistoryId: notification.historyId,
          }
    );
  }
};

export default withSentryReporting({
  async fetch(request: Request, env: Env) {
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
      request.signal.throwIfAborted();
      await acceptGmailJob(parsed.data, env);
      request.signal.throwIfAborted();
      const placement = request.headers.get("cf-placement");
      return Response.json(
        { action: "ack" },
        placement !== null && /^(?:local|remote)-[A-Z]{3}$/u.test(placement)
          ? { headers: { "cf-placement": placement } }
          : undefined
      );
    } catch (error) {
      return requestErrorResponse(error, "gmail-processing");
    }
  },
  async queue(batch, env) {
    await executeGmailMailboxDispatch(batch, env);
  },
} satisfies ExportedHandler<Env>);
