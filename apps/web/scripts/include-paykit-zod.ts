import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const billingRequire = createRequire(
  new URL("../../../packages/billing/package.json", import.meta.url),
);
const paykitRequire = createRequire(billingRequire.resolve("@paykit-sdk/core"));

await cp(
  dirname(paykitRequire.resolve("zod/package.json")),
  new URL("../.vercel/output/functions/__server.func/node_modules/zod", import.meta.url),
  { recursive: true },
);
