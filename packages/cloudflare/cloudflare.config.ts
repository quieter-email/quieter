import {
  bindings,
  defineConfig,
  exports as workerExports,
  triggers,
} from "cf/config";

import { COMPATIBILITY_DATE } from "./src/compatibility-date.ts";

export default defineConfig({
  worker: {
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/local-worker.ts",
    env: {
      GmailLiveSyncMailboxV2: bindings.durableObject({
        exportName: "GmailLiveSyncMailboxV2",
        worker: "quieter-local-background",
      }),
      GmailPsQueue: bindings.queue({ name: "quieter-local-gmail" }),
      LocalMailStorage: bindings.r2({
        dev: { remote: false },
        name: "quieter-local-mail",
      }),
      MailLiveUser: bindings.durableObject({
        exportName: "MailLiveUser",
        worker: "quieter-local-background",
      }),
    },
    exports: {
      GmailLiveSyncMailboxV2: workerExports.durableObject({
        storage: "sqlite",
      }),
      MailLiveUser: workerExports.durableObject({ storage: "sqlite" }),
    },
    name: "quieter-local-background",
    triggers: [
      triggers.queue({
        deadLetterQueue: "quieter-local-gmail-failed",
        maxBatchSize: 1,
        maxBatchTimeout: 0,
        maxRetries: 5,
        name: "quieter-local-gmail",
      }),
    ],
  },
});
