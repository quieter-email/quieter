import "../instrument.server.mjs";
import { serverEnv } from "@quieter/env/server";
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

const serverEntry = {
  fetch(request: Request) {
    return handler.fetch(request);
  },
};

export default createServerEntry(
  serverEnv.NODE_ENV !== "development" && serverEnv.SENTRY_DSN
    ? wrapFetchWithSentry(serverEntry)
    : serverEntry,
);
