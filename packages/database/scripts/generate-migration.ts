import { exitOnKitError, generate, kitOptions } from "./drizzle-kit";

const response = await generate(kitOptions);
exitOnKitError(response);

if (response.status === "ok") {
  if ("migration_path" in response) {
    console.log(`Generated migration at ${response.migration_path}`);
  } else {
    console.log("Generated migration");
  }
} else if (response.status === "no_changes") {
  console.log("Schema in sync — no migration needed");
} else if (response.status === "missing_hints") {
  console.error(
    "Schema generation needs hint resolutions for ambiguous changes. Run db:generate from an interactive session or provide hints through the drizzle-kit SDK.",
  );
  globalThis.process.exit(1);
}
