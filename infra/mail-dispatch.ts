import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import type { createMailUpdateResources } from "./mail-updates";
import {
  cloudflareWorkerBuild,
  cloudflareWorkerObservability,
} from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import type { SecretBindings, SecretResources } from "./types";

export const createMailDispatchWorker = (input: {
  appDatabase: ReturnType<typeof createAppDatabase>;
  gmailProcessor: sst.cloudflare.Worker | undefined;
  maintenanceScript: $util.Output<string>;
  secretBindings: SecretBindings;
  secretResources: SecretResources;
  updates: ReturnType<typeof createMailUpdateResources>;
}) => {
  const worker = new sst.cloudflare.Worker("MailDispatchWorker", {
    build: cloudflareWorkerBuild,
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
    handler: "packages/cloudflare/src/mail-dispatch-worker.ts",
    link: [
      input.appDatabase,
      input.updates.user,
      ...(input.gmailProcessor === undefined ? [] : [input.gmailProcessor]),
      requireSecretBinding(input.secretBindings, "SENTRY_DSN"),
      requireSecretResource(
        input.secretResources,
        "GMAIL_LIVE_SYNC_TOKEN_SECRET"
      ),
    ],
    transform: {
      worker(args) {
        args.bindings = $util
          .all([
            args.bindings,
            input.updates.worker.nodes.worker.scriptName,
            input.maintenanceScript,
          ])
          .apply(([bindings, updatesScript, maintenanceScript]) => [
            ...(bindings ?? []).map((binding) =>
              binding.name === "MailLiveUser"
                ? { ...binding, scriptName: updatesScript }
                : binding
            ),
            {
              name: "MAIL_MAINTENANCE",
              service: maintenanceScript,
              type: "service",
            },
          ]);
        args.observability = cloudflareWorkerObservability;
      },
    },
    url: true,
  });
  return worker.url.apply((url) => (url ? `${url}/mail/dispatch/event` : ""));
};
