import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(
  path.join(root, "packages/ui/src/assets/brand-icon.svg"),
  "utf-8"
);
const icon = source.replace(
  /<clipPath id="corners">.*?<\/clipPath>/u,
  '<clipPath id="corners"><path d="M500 0C927.5 0 1000 72.5 1000 500C1000 927.5 927.5 1000 500 1000C72.5 1000 0 927.5 0 500C0 72.5 72.5 0 500 0Z"/></clipPath>'
);
if (icon === source) {
  throw new Error("The shared brand icon is missing its corner clip path.");
}
const scratch = path.join(root, ".scratch");
mkdirSync(scratch, { recursive: true });
const input = path.join(scratch, "desktop-icon.svg");
writeFileSync(input, icon);
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/@resvg/resvg-js-cli/bin/resvg-js-cli.mjs"),
    "--no-system-font",
    "--fit-width",
    "512",
    "--fit-height",
    "512",
    input,
    path.join(root, "apps/desktop/resources/icon.png"),
  ],
  { encoding: "utf-8" }
);
if (result.error || result.status !== 0) {
  throw new Error(
    `Desktop icon export failed: ${result.error?.message ?? result.stderr}`
  );
}
