import { exitOnKitError, generate, kitOptions } from "./drizzle-kit.ts";

const response = await generate(kitOptions);
exitOnKitError(response);

if (response.status === "ok") {
  if ("migration_path" in response) {
    process.stdout.write(`Generated migration at ${response.migration_path}\n`);
  } else {
    process.stdout.write("Generated migration\n");
  }
} else if (response.status === "no_changes") {
  process.stdout.write("Schema in sync — no migration needed\n");
} else if (response.status === "missing_hints") {
  process.stderr.write(
    "Schema generation needs hint resolutions for ambiguous changes. Run db:generate from an interactive session or provide hints through the drizzle-kit SDK." +
      "\n"
  );
  throw new Error("Schema generation requires hint resolutions.");
}
