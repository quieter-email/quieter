import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createDeploymentVerificationEnv,
  DEPLOYMENT_ASSET_PREFIX,
  DEPLOYMENT_BOOTSTRAP_HEADER,
  DEPLOYMENT_BUILD_HEADER,
  DEPLOYMENT_PROBE_HEADER,
  DEPLOYMENT_STATUS_PATH,
  DEPLOYMENT_VERSION_HEADER,
  deploymentManifestSchema,
  deploymentStatusSchema,
  nativeWebReleaseSchema,
  PERSONAL_ACTION_PROTOCOL,
} from "@quieter/env/deployment";
import { Resource } from "sst";
import { z } from "zod";

import { checkDeploymentWithRetry } from "./check-deployment.ts";

const origin = "https://quieter.email";
const worker = "quieter-production-web-app";
const planFile = ".sst/native-web-release.json";
const appDirectory = "apps/web";
const workerConfig = `${appDirectory}/.cloudflare/output/v1/workers/default/worker.config.json`;
const bootstrapTag = "quieter-web-bootstrap";
const retentionMs = 12 * 60 * 60 * 1000;

const releasePlanSchema = z.object({
  buildId: deploymentManifestSchema.shape.current.shape.buildId,
  current: deploymentManifestSchema.shape.current,
});
const cloudflareDeploymentSchema = z.object({
  created_on: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  versions: z.array(z.object({ percentage: z.number(), version_id: z.uuid() })),
});
const versionSchema = z.object({
  annotations: z.record(z.string(), z.string()).optional(),
  id: z.uuid(),
  resources: z.object({
    bindings: z.array(
      z.object({ name: z.string(), text: z.string().optional() })
    ),
  }),
});
const runtimeSchema = z.object({
  hyperdriveId: z.string().regex(/^[a-f0-9]{32}$/u),
  name: z.literal(worker),
  probeToken: z.string().min(32),
  secrets: z.record(z.string(), z.string()),
  vars: z.record(z.string(), z.string()),
});

const env = createDeploymentVerificationEnv();
const cloudflare = async (route: string, body?: unknown) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_DEFAULT_ACCOUNT_ID}/workers/${route}`,
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      method: body === undefined ? "GET" : "POST",
      signal: AbortSignal.timeout(30_000),
    }
  );
  const envelope = z.object({ result: z.unknown(), success: z.boolean() });
  if (!response.ok) {
    throw new Error(
      `Cloudflare request failed for ${route} (HTTP ${response.status}).`
    );
  }
  const result = envelope.parse(await response.json());
  if (!result.success) {
    throw new Error(`Cloudflare request failed for ${route}.`);
  }
  return result.result;
};

const deployVersions = async (
  versions: z.infer<typeof cloudflareDeploymentSchema>["versions"],
  message: string
) => {
  const result = await cloudflare(`scripts/${worker}/deployments`, {
    annotations: { "workers/message": message },
    strategy: "percentage",
    versions,
  });
  return cloudflareDeploymentSchema.parse(result);
};

const getDeployment = async (script: string) => {
  const { deployments } = z
    .object({ deployments: z.array(cloudflareDeploymentSchema) })
    .parse(await cloudflare(`scripts/${script}/deployments`));
  const [active] = deployments.toSorted((left, right) =>
    right.created_on.localeCompare(left.created_on)
  );
  if (active === undefined) {
    return null;
  }
  const current = active.versions.find(({ percentage }) => percentage === 100);
  if (
    !current ||
    active.versions.length > 2 ||
    active.versions.some(
      ({ percentage }) => percentage !== 100 && percentage !== 0
    )
  ) {
    throw new Error(`Unexpected traffic distribution for ${script}.`);
  }
  return {
    current: current.version_id,
    id: active.id,
    previous: active.versions.find(({ percentage }) => percentage === 0)
      ?.version_id,
  };
};

const requireDeployment = async (id: string, message: string) => {
  const active = await getDeployment(worker);
  if (active?.id !== id) {
    throw new Error(message);
  }
};

const getVersion = async (script: string, id: string) =>
  versionSchema.parse(await cloudflare(`scripts/${script}/versions/${id}`));

const retainedVersion = (current: z.infer<typeof versionSchema>) => {
  const vars = Object.fromEntries(
    current.resources.bindings.map(({ name, text }) => [name, text])
  );
  if (vars.QUIETER_WEB_RELEASE === undefined) {
    return null;
  }
  const { previous } = nativeWebReleaseSchema.parse(
    JSON.parse(vars.QUIETER_WEB_RELEASE)
  );
  if (
    !previous ||
    previous.expiresAt <= Date.now() ||
    previous.protocol !== PERSONAL_ACTION_PROTOCOL
  ) {
    return null;
  }
  return {
    ...previous,
    retainedId: z
      .uuid()
      .parse(previous.versionId ?? vars.QUIETER_WEB_BOOTSTRAP_VERSION),
  };
};

const readStatus = async () => {
  const response = await fetch(new URL(DEPLOYMENT_STATUS_PATH, origin), {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Cannot read production release status (HTTP ${response.status}).`
    );
  }
  return deploymentStatusSchema.parse(await response.json());
};

const readLegacyManifest = async () => {
  const [domain] = z
    .array(
      z.object({
        hostname: z.literal("quieter.email"),
        service: z.string().regex(/^[\w-]+$/u),
      })
    )
    .length(1)
    .parse(await cloudflare("domains?hostname=quieter.email"));
  if (domain === undefined) {
    throw new Error("The public web router domain is missing.");
  }
  const active = await getDeployment(domain.service);
  if (!active) {
    throw new Error("The public web router has no active version.");
  }
  const { resources } = await getVersion(domain.service, active.current);
  const manifest = resources.bindings.find(
    ({ name }) => name === "QUIETER_WEB_DEPLOYMENT"
  )?.text;
  return deploymentManifestSchema.parse(JSON.parse(z.string().parse(manifest)));
};

const plan = async (forceInfra: boolean) => {
  const { current } = await readStatus();
  if (current.protocol !== PERSONAL_ACTION_PROTOCOL) {
    throw new Error(
      "The active web build is incompatible with native web releases."
    );
  }
  const buildId = env.QUIETER_BUILD_ID;
  const alreadyPromoted = current.buildId === buildId;
  await mkdir(".sst", { recursive: true });
  await writeFile(planFile, JSON.stringify({ buildId, current }));
  if (alreadyPromoted) {
    process.stdout.write("verify-only=true\n");
    return;
  }
  const base = z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(current.buildId.split("-")[0]);
  execFileSync("git", ["merge-base", "--is-ancestor", base, env.GITHUB_SHA]);
  const changes = execFileSync(
    "git",
    ["diff", "--name-only", "-z", base, env.GITHUB_SHA],
    { encoding: "utf-8" }
  );
  const webOnly = changes
    .split("\0")
    .filter(Boolean)
    .every((file) => /^(?:apps\/web\/|docs\/)/u.test(file));
  const syncInfra = forceInfra || !webOnly || current.versionId === undefined;
  if (syncInfra) {
    const fallback = await readLegacyManifest();
    await writeFile(
      ".sst/web-deployment.json",
      JSON.stringify({
        manifest: fallback,
        sourceBuildId: fallback.current.buildId,
        sourceDeployment: fallback.current,
        updateSlot: null,
      })
    );
    process.stdout.write(`sst-build-id=${fallback.current.buildId}\n`);
  }
  process.stdout.write(
    `infrastructure=${syncInfra}\nbootstrap=${current.versionId === undefined}\n`
  );
};

const bootstrap = async () => {
  if (await getDeployment(worker)) {
    return;
  }
  const { nativeWebWorkerId } = z
    .object({ nativeWebWorkerId: z.string().regex(/^[\w-]+$/u) })
    .parse(JSON.parse(await readFile(".sst/outputs.json", "utf-8")));
  const script = `export default { fetch() { return new Response(null, {status:404,headers:{${JSON.stringify(DEPLOYMENT_BOOTSTRAP_HEADER)}:"1","cache-control":"no-store"}}) } };`;
  const { id } = z.object({ id: z.uuid() }).parse(
    await cloudflare(`workers/${nativeWebWorkerId}/versions`, {
      annotations: { "workers/tag": bootstrapTag },
      main_module: "bootstrap.js",
      modules: [
        {
          content_base64: Buffer.from(script).toString("base64"),
          content_type: "application/javascript+module",
          name: "bootstrap.js",
        },
      ],
    })
  );
  await deployVersions(
    [{ percentage: 100, version_id: id }],
    "Seed private web Worker"
  );
};

const uploadCandidate = async (
  release: z.infer<typeof nativeWebReleaseSchema>,
  runtime: z.infer<typeof runtimeSchema>,
  buildId: string,
  bootstrapVersion: string | undefined
) => {
  const config = z
    .object({
      compatibilityDate: z.iso.date(),
      compatibilityFlags: z.array(z.string()),
      manifest: z.object({ mainModule: z.string().regex(/^[\w.-]+\.js$/u) }),
      name: z.literal(worker),
    })
    .parse(JSON.parse(await readFile(workerConfig, "utf-8")));
  const marker = await readFile(
    `${path.dirname(workerConfig)}/assets/assets/build-id.txt`,
    "utf-8"
  );
  if (marker.trim() !== buildId) {
    throw new Error("The web build output does not match the planned release.");
  }
  const secrets = Object.fromEntries(
    Object.entries(runtime.secrets).filter(([, value]) => value !== "")
  );
  const output = path.resolve(path.dirname(workerConfig));
  const directory = await mkdtemp(path.join(tmpdir(), "quieter-web-release-"));
  try {
    const secretsFile = path.join(directory, "secrets.json");
    const uploadResult = path.join(directory, "upload.jsonl");
    const wranglerConfig = path.join(directory, "wrangler.json");
    await Promise.all([
      writeFile(secretsFile, JSON.stringify(secrets), { mode: 0o600 }),
      writeFile(
        wranglerConfig,
        JSON.stringify({
          assets: {
            binding: "ASSETS",
            directory: path.join(output, "assets"),
            run_worker_first: [
              `${DEPLOYMENT_ASSET_PREFIX}*`,
              DEPLOYMENT_STATUS_PATH,
              "/assets/build-id.txt",
            ],
          },
          compatibility_date: config.compatibilityDate,
          compatibility_flags: config.compatibilityFlags,
          hyperdrive: [{ binding: "AppDatabaseV2", id: runtime.hyperdriveId }],
          main: path.join(output, "bundle", config.manifest.mainModule),
          name: worker,
          preview_urls: false,
          rules: [
            { globs: ["**/*.js", "**/*.mjs"], type: "ESModule" },
            { globs: ["**/*.css", "**/*.txt"], type: "Text" },
            { globs: ["**/*.wasm"], type: "CompiledWasm" },
          ],
          vars: {
            ...runtime.vars,
            ...(bootstrapVersion === undefined
              ? {}
              : { QUIETER_WEB_BOOTSTRAP_VERSION: bootstrapVersion }),
            QUIETER_WEB_RELEASE: JSON.stringify(release),
          },
          version_metadata: { binding: "QUIETER_WORKER_VERSION" },
          workers_dev: false,
        })
      ),
    ]);
    try {
      execFileSync(
        "vp",
        [
          "exec",
          "wrangler",
          "versions",
          "upload",
          "--no-bundle",
          "--config",
          wranglerConfig,
          "--tag",
          buildId,
          "--secrets-file",
          secretsFile,
        ],
        {
          cwd: appDirectory,
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_DEFAULT_ACCOUNT_ID,
            WRANGLER_OUTPUT_FILE_PATH: uploadResult,
          },
          stdio: ["ignore", "ignore", "pipe"],
          timeout: 300_000,
        }
      );
    } catch (error) {
      const { status } = z
        .object({ status: z.number().nullish() })
        .parse(error);
      throw new Error(
        `Cloudflare could not upload the prepared web candidate (exit ${status ?? "unknown"}).`,
        { cause: error }
      );
    }
    const event = z.object({
      type: z.literal("version-upload"),
      version_id: z.uuid(),
      worker_name: z.literal(worker),
    });
    const events = await readFile(uploadResult, "utf-8");
    for (const line of events.trim().split("\n")) {
      const result = event.safeParse(JSON.parse(line));
      if (result.success) {
        return result.data.version_id;
      }
    }
    throw new Error("Cloudflare did not report the uploaded web version.");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

const publish = async () => {
  const original = releasePlanSchema.parse(
    JSON.parse(await readFile(planFile, "utf-8"))
  );
  const { buildId } = original;
  if (buildId !== env.QUIETER_BUILD_ID) {
    throw new Error("The native web plan is for a different build.");
  }
  const status = await readStatus();
  if (status.current.buildId === buildId && status.current.versionId) {
    await checkDeploymentWithRetry(origin, buildId);
    return;
  }
  const active = await getDeployment(worker);
  if (
    !active ||
    status.current.buildId !== original.current.buildId ||
    status.current.versionId !== original.current.versionId
  ) {
    throw new Error("The production predecessor changed after preparation.");
  }
  const previous = await getVersion(worker, active.current);
  const isBootstrap =
    !original.current.versionId &&
    previous.annotations?.["workers/tag"] === bootstrapTag;
  if (!isBootstrap && active.current !== original.current.versionId) {
    throw new Error(
      "Cloudflare and the public router disagree about the active web version."
    );
  }
  const runtime = runtimeSchema.parse(
    Reflect.get(Resource, "WebReleaseRuntime")
  );
  const candidate = await uploadCandidate(
    {
      previous: {
        ...original.current,
        expiresAt: status.serverTime + retentionMs,
      },
      slot: original.current.slot === "a" ? "b" : "a",
    },
    runtime,
    buildId,
    isBootstrap ? active.current : undefined
  );
  await requireDeployment(
    active.id,
    "The active deployment changed before staging."
  );
  const staged = await deployVersions(
    [
      { percentage: 100, version_id: active.current },
      { percentage: 0, version_id: candidate },
    ],
    `Stage ${buildId}`
  );
  try {
    await checkDeploymentWithRetry(origin, buildId, undefined, {
      [DEPLOYMENT_BUILD_HEADER]: buildId,
      [DEPLOYMENT_PROBE_HEADER]: runtime.probeToken,
      [DEPLOYMENT_VERSION_HEADER]: candidate,
    });
    const confirmed = await readStatus();
    await requireDeployment(
      staged.id,
      "The active deployment changed during the candidate check."
    );
    if (
      confirmed.current.buildId !== original.current.buildId ||
      confirmed.current.versionId !== original.current.versionId
    ) {
      throw new Error(
        "The active web release changed during the candidate check."
      );
    }
  } catch (error) {
    const afterFailure = await getDeployment(worker);
    if (afterFailure?.id === staged.id) {
      const retained = retainedVersion(previous);
      await deployVersions(
        [
          { percentage: 100, version_id: active.current },
          ...(retained
            ? [{ percentage: 0, version_id: retained.retainedId }]
            : []),
        ],
        `Discard failed candidate ${buildId}`
      );
    }
    throw error;
  }
  await deployVersions(
    [
      { percentage: 100, version_id: candidate },
      { percentage: 0, version_id: active.current },
    ],
    `Promote ${buildId}`
  );
  process.stdout.write(`Promoted web build ${buildId}.\n`);
};

const rollback = async (expectedVersion: string) => {
  const active = await getDeployment(worker);
  if (!active || active.current !== expectedVersion) {
    throw new Error(
      "The active web version differs from the approved rollback source."
    );
  }
  const current = await getVersion(worker, active.current);
  const target = retainedVersion(current);
  if (!target) {
    throw new Error(
      "There is no retained compatible web build to roll back to."
    );
  }
  const previous = await getVersion(worker, target.retainedId);
  const expectedTag =
    target.versionId === undefined ? bootstrapTag : target.buildId;
  if (
    previous.annotations?.["workers/tag"] !== expectedTag ||
    previous.id !== target.retainedId
  ) {
    throw new Error(
      "The retained build and Cloudflare rollback candidate differ."
    );
  }
  if (target.versionId === undefined) {
    const fallback = await readLegacyManifest();
    if (
      fallback.current.buildId !== target.buildId ||
      fallback.current.slot !== target.slot
    ) {
      throw new Error("The legacy rollback target changed after adoption.");
    }
  }
  await requireDeployment(
    active.id,
    "The web deployment changed during rollback preparation."
  );
  const staged =
    active.previous === target.retainedId
      ? active
      : await deployVersions(
          [
            { percentage: 100, version_id: active.current },
            { percentage: 0, version_id: target.retainedId },
          ],
          `Make rollback target available ${target.buildId}`
        );
  const runtime = runtimeSchema.parse(
    Reflect.get(Resource, "WebReleaseRuntime")
  );
  await checkDeploymentWithRetry(origin, target.buildId, undefined, {
    [DEPLOYMENT_BUILD_HEADER]: target.buildId,
    [DEPLOYMENT_PROBE_HEADER]: runtime.probeToken,
    [DEPLOYMENT_VERSION_HEADER]: target.versionId ?? "legacy",
  });
  await requireDeployment(
    staged.id,
    "The web deployment changed during the rollback check."
  );
  await deployVersions(
    [{ percentage: 100, version_id: target.retainedId }],
    `Restore ${target.buildId}`
  );
  process.stdout.write(`Restored web build ${target.buildId}.\n`);
  await checkDeploymentWithRetry(origin, target.buildId);
};

const [operation, force] = process.argv.slice(2);
if (operation === "plan") {
  await plan(force === "force-infrastructure");
} else if (operation === "bootstrap") {
  await bootstrap();
} else if (operation === "publish") {
  await publish();
} else if (operation === "rollback") {
  await rollback(z.uuid().parse(force));
} else {
  throw new Error(
    "Usage: native-web-release.ts plan [force-infrastructure]|bootstrap|publish|rollback"
  );
}
