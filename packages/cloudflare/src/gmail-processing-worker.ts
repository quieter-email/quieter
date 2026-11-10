import { readBoundedJson } from "./bounded-json";
import {
  GMAIL_JOB_BODY_LIMIT,
  GMAIL_PROCESSING_URL,
  gmailJobSchema,
  processGmailJob,
} from "./gmail-processing-job";
import type { GmailProcessingEnv } from "./gmail-processing-job";
import { RequestError, requestErrorResponse } from "./request-error";
import { withSentryReporting } from "./worker-runtime";

export default withSentryReporting({
  async fetch(request: Request, env: GmailProcessingEnv) {
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
      const decision = await processGmailJob(parsed.data, env);
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
