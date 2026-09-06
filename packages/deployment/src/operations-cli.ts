import { spawn } from "node:child_process";
import path from "node:path";

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  createReleaseOperationsChildEnv,
  createReleaseOperationsEnv,
} from "@quieter/env/deployment";
import { z } from "zod";

const [purpose, operation, ...args] = process.argv.slice(2);
const target = z.enum(["runtime", "recovery", "source-maps"]).parse(purpose);
if (
  (target === "runtime" && !["release", "archive"].includes(operation ?? "")) ||
  (target === "recovery" && operation !== "reconcile") ||
  (target === "source-maps" && operation !== "upload")
) {
  throw new Error(
    "Choose an operation supported by these release credentials."
  );
}
const env = createReleaseOperationsEnv(target);
const client = new SSMClient({
  maxAttempts: 1,
  region: env.AWS_REGION,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15_000,
    throwOnRequestTimeout: true,
  },
});
let value: string;
try {
  const { Parameter: parameter } = await client.send(
    new GetParameterCommand({
      Name: env.QUIETER_RELEASE_BINDINGS_PARAMETER,
      WithDecryption: true,
    })
  );
  if (
    parameter?.ARN !== env.QUIETER_RELEASE_BINDINGS_PARAMETER ||
    parameter.Type !== "SecureString" ||
    parameter.Value === undefined ||
    Buffer.byteLength(parameter.Value) > 4096
  ) {
    throw new Error("Release binding lookup returned an invalid parameter.");
  }
  value = parameter.Value;
} catch {
  throw new Error("Could not load the intended release operation bindings.");
} finally {
  client.destroy();
}
const environment = createReleaseOperationsChildEnv(
  value,
  env.QUIETER_RELEASE_STAGE,
  target
);
let entry = "cli.ts";
if (target === "source-maps") {
  entry = "source-map-upload-cli.ts";
} else if (operation === "archive") {
  entry = "archive-cli.ts";
}
// oxlint-disable-next-line promise/avoid-new -- Run pinned repository tooling with inherited stdio while keeping linked secrets out of arguments and logs.
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      path.join(import.meta.dirname, entry),
      ...(target === "recovery" ? ["reconcile"] : []),
      ...args,
    ],
    { env: environment, stdio: "inherit", windowsHide: true }
  );
  child.once("error", () => {
    reject(new Error("Release operation could not start."));
  });
  child.once("exit", (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(
        new Error(
          "Release operation failed. Inspect its retained state before retrying."
        )
      );
    }
  });
});
