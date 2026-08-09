import "../instrument.server.ts";
import { serverEnv } from "@quieter/env/server";
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

const serverEntry = {
  async fetch(request: Request) {
    return await handler.fetch(request);
  },
};

export default createServerEntry(
  serverEnv.NODE_ENV !== "development" && (serverEnv.SENTRY_DSN ?? "") !== ""
    ? wrapFetchWithSentry(serverEntry)
    : serverEntry
);
