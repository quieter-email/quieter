import { serverEnv } from "@quieter/env/server";

import { syncUnreportedBillingCreditUsage } from "../src/credits.ts";

const limit = Number(serverEnv.POLAR_CREDIT_USAGE_SYNC_LIMIT ?? 100);

if (!Number.isInteger(limit) || limit <= 0) {
  throw new Error("POLAR_CREDIT_USAGE_SYNC_LIMIT must be a positive integer.");
}

let totalSynced = 0;
let remaining = true;

const syncAllCreditUsage = async (): Promise<void> => {
  const { synced, remaining: hasMore } = await syncUnreportedBillingCreditUsage(
    { limit }
  );
  totalSynced += synced;
  remaining = hasMore;

  if (synced === 0 || !remaining) {
    return;
  }

  await syncAllCreditUsage();
};

await syncAllCreditUsage();

process.stdout.write(`Synced ${totalSynced} credit usage events to Polar.\n`);
