import { syncPolarCatalog } from "../src/index.ts";
import { getPolarSandboxMode } from "../src/polar.ts";

const products = syncPolarCatalog();

process.stdout.write(
  `${JSON.stringify(
    {
      environment: getPolarSandboxMode() ? "sandbox" : "production",
      products,
    },
    null,
    2
  )}\n`
);
