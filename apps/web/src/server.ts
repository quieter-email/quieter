import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { createServerSentryOptions } from "../instrument.server";

const serverEntry = {
  async fetch(request: Request) {
    return await handler.fetch(request);
  },
};

export default Sentry.withSentry(
  (runtimeEnv) => createServerSentryOptions(runtimeEnv),
  createServerEntry(serverEntry)
);
