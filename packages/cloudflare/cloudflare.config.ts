import { bindings, defineConfig, exports as workerExports } from "cf/config";

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
  },
});
