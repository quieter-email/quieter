import { syncPolarCatalog } from "../src";
import { getPolarSandboxMode } from "../src/polar";

const products = await syncPolarCatalog();

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
