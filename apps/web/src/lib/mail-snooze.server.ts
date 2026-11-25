import { serverEnv } from "@quieter/env/server";
import { readMailSnoozeTicket } from "@quieter/mail/snooze-ticket";

import { reportServerError } from "./server-error-reporting";

export const handleMailSnoozeDispatch = async (request: Request) => {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "POST") {
    return new Response(null, {
      headers: { ...headers, allow: "POST" },
      status: 405,
    });
  }
  const parsed = await readMailSnoozeTicket(
    request,
    serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET,
    "mail-snooze-dispatch"
  );
  if (!parsed.ok) {
    return new Response(null, { headers, status: parsed.status });
  }
  try {
    const { dispatchMailSnooze } = await import("@quieter/orpc/snooze/service");
    const { id, mailboxId } = parsed.ticket;
    return Response.json(await dispatchMailSnooze({ id, mailboxId }), {
      headers,
    });
  } catch (error) {
    reportServerError(error, "mail-snooze-dispatch");
    return new Response(null, { headers, status: 500 });
  }
};
