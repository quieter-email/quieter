import path from "node:path";

import { assertLocalEnvFile } from "../src/local-doctor";

const localEnvPath = path.join(import.meta.dirname, "../../../.env.local");
assertLocalEnvFile(localEnvPath);

process.stdout.write(
  "Local environment uses bounded in-process background work and no persistent cloud queues." +
    "\n"
);
