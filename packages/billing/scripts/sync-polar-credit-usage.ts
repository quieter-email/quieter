import { syncUnreportedBillingCreditUsage } from "../src/credits";

const limit = Number(process.env.POLAR_CREDIT_USAGE_SYNC_LIMIT ?? 100);

if (!Number.isInteger(limit) || limit <= 0) {
  throw new Error("POLAR_CREDIT_USAGE_SYNC_LIMIT must be a positive integer.");
}

let totalSynced = 0;
let remaining = true;

while (remaining) {
  const result = await syncUnreportedBillingCreditUsage({ limit });
  totalSynced += result.synced;
  remaining = result.remaining;

  if (result.synced === 0) break;
}

console.log(`Synced ${totalSynced} credit usage events to Polar.`);
