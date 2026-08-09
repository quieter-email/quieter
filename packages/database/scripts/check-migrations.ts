import { check, exitOnKitError, kitOptions } from "./drizzle-kit";

const response = await check(kitOptions);
exitOnKitError(response);

if (response.status === "ok") {
  process.stdout.write(`Migrations folder is valid (${response.dialect})\n`);
}
