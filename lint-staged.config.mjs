const drizzleSnapshotPattern =
  /[\\/]packages[\\/]database[\\/]drizzle[\\/][^\\/]+[\\/]snapshot\.json$/;

const quotePath = (path) => `"${path.replaceAll('"', '\\"')}"`;

const command = (baseCommand, files) =>
  files.length === 0 ? [] : `${baseCommand} ${files.map(quotePath).join(" ")}`;

export default {
  "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,json,jsonc}": (files) =>
    command(
      "oxfmt --config oxfmt.json",
      files.filter((file) => !drizzleSnapshotPattern.test(file)),
    ),
  "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}": (files) =>
    command("oxlint --fix --config oxlint.json", files),
};
