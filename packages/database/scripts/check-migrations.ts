import { check, exitOnKitError, kitOptions } from "./drizzle-kit.ts";

const response = await check(kitOptions);
exitOnKitError(response);

if (response.status === "ok") {
  process.stdout.write(`Migrations folder is valid (${response.dialect})\n`);
}
