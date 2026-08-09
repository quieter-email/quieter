import { syncPolarCatalog } from "../src";
import { getPolarSandboxMode } from "../src/polar";

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
