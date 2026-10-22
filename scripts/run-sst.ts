import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";

import { deriveWebReleaseScope } from "../infra/web-release-scope.ts";

export const prepareSstArguments = async (input: {
  args: string[];
  projectRoot: string;
  runtimeEnv: NodeJS.ProcessEnv;
}) => {
  const { args, projectRoot, runtimeEnv } = input;
  const { positionals, tokens, values } = parseArgs({
    allowPositionals: true,
    args,
    // SST registers string flags from every subcommand before finding the command.
    options: {
      config: { type: "string" },
      exclude: { type: "string" },
      filter: { type: "string" },
      help: { type: "boolean" },
      host: { type: "string" },
      mode: { type: "string" },
      policy: { type: "string" },
      port: { type: "string" },
      stage: { type: "string" },
      subnets: { type: "string" },
      target: { type: "string" },
      user: { type: "string" },
    },
    strict: false,
    tokens: true,
  });
  const [operation] = positionals;
  if (
    (operation !== "diff" && operation !== "deploy") ||
    ["1", "t", "true"].includes(String(values.help).toLowerCase())
  ) {
    return args;
  }
  const { createSstCommandEnv } = await import("@quieter/env/sst");

  // SST loads the root dotenv before stage selection, then overrides stage dotenv.
  const envFile = path.join(projectRoot, ".env");
  const environment = {
    ...(existsSync(envFile) ? parseEnv(await readFile(envFile, "utf-8")) : {}),
    ...runtimeEnv,
  };
  const env = createSstCommandEnv(environment);
  const config = typeof values.config === "string" ? values.config : "";
  const configDirectory = path.dirname(
    path.resolve(projectRoot, config || "sst.config.ts")
  );
  const personalStageFile = path.join(configDirectory, ".sst", "stage");
  const requestedStage = typeof values.stage === "string" ? values.stage : "";
  const personalStage =
    !requestedStage && !env.SST_STAGE && existsSync(personalStageFile)
      ? await readFile(personalStageFile, "utf-8")
      : "";
  const stage = requestedStage || env.SST_STAGE || personalStage.trim();
  if (stage === "") {
    throw new Error(
      "Specify --stage or SST_STAGE, or save a personal stage in .sst/stage, before diff or deploy."
    );
  }
  if (stage !== "production") {
    return args;
  }
  if (
    tokens.some(
      (token) =>
        token.kind === "option" &&
        (token.name === "target" || token.name === "exclude")
    )
  ) {
    throw new Error(
      "Production web retention owns --target and --exclude. Use the captured release plan."
    );
  }

  const stageEnvFile = path.join(configDirectory, ".env.production");
  const deploymentEnv = createSstCommandEnv({
    ...environment,
    ...(existsSync(stageEnvFile)
      ? parseEnv(await readFile(stageEnvFile, "utf-8"))
      : {}),
  });
  const planBytes = await readFile(
    path.join(projectRoot, ".sst", "web-deployment.json")
  );
  const { webReleasePlanSchema } = await import("@quieter/env/deployment");
  const plan = webReleasePlanSchema.parse(
    JSON.parse(planBytes.toString("utf-8"))
  );
  if (plan.manifest.current.buildId !== deploymentEnv.QUIETER_BUILD_ID) {
    throw new Error("The prepared web routing belongs to another build.");
  }
  const fingerprint = JSON.stringify({
    buildId: plan.manifest.current.buildId,
    plan: createHash("sha256").update(planBytes).digest("hex"),
  });
  const fingerprintPath = path.join(
    projectRoot,
    ".sst",
    "prepared-web-plan.json"
  );
  if (operation === "diff") {
    await writeFile(fingerprintPath, fingerprint);
  } else if (
    !existsSync(fingerprintPath) ||
    (await readFile(fingerprintPath, "utf-8")) !== fingerprint
  ) {
    throw new Error(
      "The web release plan changed or has no preview. Run vp run sst diff again."
    );
  }
  const scope = deriveWebReleaseScope(plan);
  if (scope.excludedSlots.length === 0) {
    return args;
  }
  const separator = args.indexOf("--");
  const insertion = separator === -1 ? args.length : separator;
  return [
    ...args.slice(0, insertion),
    "--exclude",
    scope.excludedSlots.map(({ componentName }) => componentName).join(","),
    ...args.slice(insertion),
  ];
};

if (import.meta.main) {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const sstEntryPath = path.join(
    projectRoot,
    "node_modules",
    "sst",
    "bin",
    "sst.mjs"
  );
  const args = await prepareSstArguments({
    args: process.argv.slice(2),
    projectRoot,
    runtimeEnv: process.env,
  });
  const child = spawn(process.execPath, [sstEntryPath, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    throw error;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
