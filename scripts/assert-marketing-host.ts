import { productionSiteOrigin, surfaceHeader } from "@quieter/env/hosts";

export const assertMarketingHost = async () => {
  const response = await fetch(new URL("/home", productionSiteOrigin), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.headers.get(surfaceHeader) !== "site") {
    throw new Error(
      "quieter.email is not served by the site worker. Run the cutover deploy before an app-only or site-only production deploy, or the landing host can be detached."
    );
  }
};

if (import.meta.main) {
  await assertMarketingHost();
}
