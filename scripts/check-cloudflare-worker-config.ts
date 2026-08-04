const compatibilityDate = "2026-08-04";
const expectedDateCounts = new Map([
  ["sst.config.ts", 2],
  ["apps/web/local-worker.jsonc", 1],
  ["packages/cloudflare/wrangler.types.jsonc", 1],
  [".github/review-worker.wrangler.jsonc", 1],
  [".github/workflows/ci-main.yml", 1],
  [".github/workflows/review-deploy.yml", 2],
]);

const failures: string[] = [];
for (const [path, expectedCount] of expectedDateCounts) {
  const source = await Bun.file(path).text();
  const dates = [
    ...source.matchAll(
      /(?:compatibility_date["\\]*\s*:\s*["\\]*|date:\s*"|--compatibility-date\s+)(\d{4}-\d{2}-\d{2})/g,
    ),
  ].map((match) => match[1]);
  if (dates.length !== expectedCount || dates.some((date) => date !== compatibilityDate)) {
    failures.push(
      `${path}: expected ${expectedCount} occurrence(s) of ${compatibilityDate}, found ${dates.join(", ") || "none"}`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Cloudflare Worker compatibility date is consistently ${compatibilityDate}.`);
