import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { COMPATIBILITY_DATE } from "../src/compatibility-date.ts";

const root = path.join(import.meta.dirname, "../../..");
const check = process.argv.includes("--check");
const targets = [
  "local-worker.jsonc",
  "local-background-worker.jsonc",
  "packages/cloudflare/wrangler.types.jsonc",
] as const;

const datePattern =
  /(?<prefix>"compatibility_date"\s*:\s*")\d{4}-\d{2}-\d{2}(?<suffix>")/u;

const syncCompatibilityDate = async (
  relativePath: (typeof targets)[number]
) => {
  const filePath = path.join(root, relativePath);
  const source = await readFile(filePath, "utf-8");
  const match = datePattern.exec(source);
  if (match === null) {
    return `${relativePath}: missing compatibility_date`;
  }

  const currentMatch = /\d{4}-\d{2}-\d{2}/u.exec(match[0]);
  const current = currentMatch?.[0];
  if (current === COMPATIBILITY_DATE) {
    return null;
  }

  if (check) {
    return `${relativePath}: expected compatibility_date ${COMPATIBILITY_DATE}, found ${current ?? "none"}`;
  }

  const updated = source.replace(
    datePattern,
    `$<prefix>${COMPATIBILITY_DATE}$<suffix>`
  );
  await writeFile(filePath, updated);
  process.stdout.write(`Updated ${relativePath} → ${COMPATIBILITY_DATE}\n`);
  return null;
};

const results = await Promise.all(
  targets.map(async (target) => await syncCompatibilityDate(target))
);
const failures = results.flatMap((failure) =>
  failure === null ? [] : [failure]
);

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.stderr.write(
    "Run: vp run @quieter/cloudflare#sync:compatibility-date\n"
  );
  throw new Error("Cloudflare Worker compatibility_date is out of sync.");
}

if (check) {
  process.stdout.write(
    `Cloudflare Worker compatibility_date is ${COMPATIBILITY_DATE} in committed wrangler configs.` +
      "\n"
  );
}
