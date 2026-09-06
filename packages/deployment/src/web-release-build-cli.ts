import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { buildWebRelease } from "./web-release-build.ts";

const { values } = parseArgs({
  options: {
    directory: { type: "string" },
    output: { type: "string" },
    "public-config": { type: "string" },
    stage: { type: "string" },
  },
});
if (
  values.directory === undefined ||
  values.output === undefined ||
  values.stage === undefined
) {
  throw new Error(
    "Release build requires --directory, --output, and --stage; --public-config accepts a public settings JSON file."
  );
}
const manifest = await buildWebRelease({
  directory: values.directory,
  output: values.output,
  publicConfiguration:
    values["public-config"] === undefined
      ? {}
      : JSON.parse(await readFile(values["public-config"], "utf-8")),
  stage: values.stage,
});
process.stdout.write(
  `Verified release build ${manifest.digest}, source ${manifest.artifact.sourceSha}, stage ${manifest.artifact.provenance?.stage}.\n`
);
