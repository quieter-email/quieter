import { serverEnv } from "@quieter/env/server";
import { readScheduledSendTicket } from "@quieter/mail/scheduled-send-ticket";

import { reportServerError } from "./server-error-reporting";

export const handleScheduledSendDispatch = async (request: Request) => {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "POST") {
    return new Response(null, {
      headers: { ...headers, allow: "POST" },
      status: 405,
    });
  }
  const parsed = await readScheduledSendTicket(
    request,
    serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET,
    "scheduled-send-dispatch"
  );
  if (!parsed.ok) {
    return new Response(null, { headers, status: parsed.status });
  }
  try {
    const { dispatchScheduledSend } =
      await import("@quieter/orpc/scheduled-send/service");
    const { id, mailboxId, userId } = parsed.ticket;
    return Response.json(
      await dispatchScheduledSend({ id, mailboxId, userId }),
      {
        headers,
      }
    );
  } catch (error) {
    reportServerError(error, "scheduled-send-dispatch");
    return new Response(null, { headers, status: 500 });
  }
};
