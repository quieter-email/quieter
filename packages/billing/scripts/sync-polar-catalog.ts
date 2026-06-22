import { syncPolarCatalog } from "../src";
import { getPolarSandboxMode } from "../src/polar";

const products = syncPolarCatalog();

console.log(
  JSON.stringify(
    {
      environment: getPolarSandboxMode() ? "sandbox" : "production",
      products,
    },
    null,
    2,
  ),
);
