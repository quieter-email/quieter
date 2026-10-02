import path from "node:path";

import { assertLocalEnvFile } from "../src/local-doctor.ts";

const localEnvPath = path.join(import.meta.dirname, "../../../.env.local");
assertLocalEnvFile(localEnvPath);

process.stdout.write(
  "Local configuration is isolated. Run dev:workers for direct Gmail processing and Durable Objects; dev:pubsub consumes only the separate development subscription." +
    "\n"
);
