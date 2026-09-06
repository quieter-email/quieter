import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { inventoryWorkerArtifact, releaseArtifactSchema } from "./artifact.ts";
import { inventoryAssets } from "./assets.ts";

const { values } = parseArgs({
  options: {
    build: { type: "string" },
    directory: { type: "string" },
    output: { type: "string" },
    sha: { type: "string" },
  },
});
if (
  values.build === undefined ||
  values.directory === undefined ||
  values.output === undefined ||
  values.sha === undefined
) {
  throw new Error(
    "Artifact inventory requires --build, --directory, --output, and --sha."
  );
}
const { artifact, digest } = await inventoryWorkerArtifact(
  values.directory,
  values.build,
  values.sha
);
const archive = artifact.assets.some(
  (file) =>
    file.path.startsWith("assets/") && file.path !== "assets/build-id.txt"
)
  ? await inventoryAssets(
      path.join(values.directory, "client"),
      values.build,
      digest
    )
  : null;
await writeFile(
  values.output,
  JSON.stringify(
    releaseArtifactSchema.parse({ archive, artifact, digest }),
    null,
    2
  ),
  { flag: "wx" }
);
process.stdout.write(
  `Verified artifact ${digest}: ${artifact.modules.length} modules, ${artifact.assets.length} static assets, ${archive?.files.length ?? 0} retained browser assets.\n`
);
