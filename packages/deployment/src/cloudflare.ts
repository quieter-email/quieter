import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import {
  artifactSchema,
  assetRoutingSchema,
  readArtifactFile,
} from "./artifact.ts";
import type { WorkerArtifact } from "./artifact.ts";
import { identifierSchema } from "./schema.ts";
import type { RuntimeProvider } from "./schema.ts";

const deploymentSchema = z.object({
  created_on: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  versions: z
    .array(z.object({ percentage: z.number(), version_id: z.uuid() }))
    .min(1),
});

export class CloudflareRuntimeProvider implements RuntimeProvider {
  private readonly base: string;
  private readonly token: string;
  private readonly request: typeof fetch;

  constructor(accountId: string, token: string, request: typeof fetch = fetch) {
    if (!/^[a-f\d]{32}$/u.test(accountId) || !token) {
      throw new Error("Cloudflare deployment credentials are incomplete.");
    }
    this.base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`;
    this.token = token;
    this.request = request;
  }

  async active(scriptName: string) {
    const result = z
      .object({ deployments: z.array(deploymentSchema).min(1) })
      .parse(await this.call(scriptName, "deployments"));
    const deployments = result.deployments.toSorted(
      (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
    );
    const [active] = deployments;
    if (active.versions.length !== 1 || active.versions[0].percentage !== 100) {
      throw new Error(
        "Split deployments require explicit reconciliation before automated release."
      );
    }
    return { id: active.id, versionId: active.versions[0].version_id };
  }

  async verifyVersion(scriptName: string, versionId: string) {
    z.uuid().parse(versionId);
    const version = z
      .object({ id: z.uuid() })
      .parse(await this.call(scriptName, `versions/${versionId}`));
    if (version.id !== versionId) {
      throw new Error("Cloudflare returned an unexpected version.");
    }
  }

  async verifyArtifact(
    scriptName: string,
    versionId: string,
    input: WorkerArtifact
  ) {
    identifierSchema.parse(scriptName);
    z.uuid().parse(versionId);
    const artifact = artifactSchema.parse(input);
    const version = z
      .object({
        annotations: z.record(z.string(), z.string()).optional(),
        assets: z.object({ config: assetRoutingSchema }).optional(),
        compatibility_date: z.iso.date(),
        compatibility_flags: z.array(z.string()),
        id: z.uuid(),
        main_module: z.string(),
        modules: z
          .array(
            z.object({
              content_base64: z.string(),
              content_type: z.string(),
              name: z.string(),
            })
          )
          .max(2000),
      })
      .parse(
        await this.call(
          null,
          `workers/${scriptName}/versions/${versionId}?include=modules`
        )
      );
    const digest = createHash("sha256")
      .update(JSON.stringify(artifact))
      .digest("hex");
    if (
      version.id !== versionId ||
      version.compatibility_date !== artifact.compatibilityDate ||
      JSON.stringify(version.compatibility_flags.toSorted()) !==
        JSON.stringify(artifact.compatibilityFlags.toSorted()) ||
      (version.annotations?.["workers/tag"] !== undefined &&
        version.annotations["workers/tag"] !== digest) ||
      version.modules.length !== artifact.modules.length ||
      (artifact.assets.length > 0 &&
        JSON.stringify(version.assets?.config) !==
          JSON.stringify(artifact.assetRouting))
    ) {
      throw new Error(
        "Provider version metadata differs from the retained artifact."
      );
    }
    const seen = new Set<string>();
    for (const module of version.modules) {
      const name =
        module.name === version.main_module ? artifact.mainModule : module.name;
      const expected = artifact.modules.find((file) => file.path === name);
      if (
        !expected ||
        seen.has(name) ||
        module.content_type !== expected.contentType ||
        module.content_base64.length > Math.ceil(expected.bytes / 3) * 4
      ) {
        throw new Error("Provider modules differ from the retained artifact.");
      }
      seen.add(name);
      const body = Buffer.from(module.content_base64, "base64");
      if (
        body.byteLength !== expected.bytes ||
        createHash("sha256").update(body).digest("hex") !== expected.digest
      ) {
        throw new Error(
          "Provider module bytes differ from the tested artifact."
        );
      }
    }
  }

  async activate(scriptName: string, versionId: string) {
    z.uuid().parse(versionId);
    await this.call(scriptName, "deployments", {
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
      }),
      method: "POST",
    });
  }

  async uploadArtifact(
    scriptName: string,
    baselineVersionId: string,
    input: WorkerArtifact,
    directory: string
  ) {
    const artifact = artifactSchema.parse(input);
    z.uuid().parse(baselineVersionId);
    const before = await this.active(scriptName);
    if (before.versionId !== baselineVersionId) {
      throw new Error("The upload baseline is no longer active.");
    }
    const baseline = z
      .object({
        assets: z.object({ config: assetRoutingSchema }).optional(),
        bindings: z.array(
          z.object({ name: identifierSchema, type: z.string() })
        ),
        compatibility_date: z.iso.date(),
        compatibility_flags: z.array(z.string()),
        id: z.uuid(),
        limits: z
          .strictObject({
            cpu_ms: z.number().optional(),
            subrequests: z.number().optional(),
          })
          .optional(),
        migration_tag: z.string().optional(),
        placement: z
          .strictObject({
            host: z.string().optional(),
            hostname: z.string().optional(),
            mode: z.string().optional(),
            region: z.string().optional(),
          })
          .optional(),
      })
      .parse(
        await this.call(
          null,
          `workers/${scriptName}/versions/${baselineVersionId}`
        )
      );
    if (baseline.migration_tag !== undefined) {
      throw new Error(
        "Durable Object lifecycle requires a separately verified upload path."
      );
    }
    if (
      baseline.id !== baselineVersionId ||
      baseline.compatibility_date !== artifact.compatibilityDate ||
      JSON.stringify(baseline.compatibility_flags.toSorted()) !==
        JSON.stringify(artifact.compatibilityFlags.toSorted())
    ) {
      throw new Error(
        "Runtime compatibility configuration requires an infrastructure transition."
      );
    }
    const assetBindings = baseline.bindings.filter(
      (binding) => binding.type === "assets"
    );
    if (
      (artifact.assets.length > 0 && assetBindings.length !== 1) ||
      (artifact.assets.length === 0 && baseline.assets !== undefined)
    ) {
      throw new Error(
        "Changing static asset bindings requires an infrastructure transition."
      );
    }
    const digest = createHash("sha256")
      .update(JSON.stringify(artifact))
      .digest("hex");
    const previousRouting = baseline.assets?.config;
    if (
      previousRouting !== undefined &&
      JSON.stringify(previousRouting) !== JSON.stringify(artifact.assetRouting)
    ) {
      throw new Error(
        "Changing static asset routing requires an infrastructure transition."
      );
    }
    const assetToken =
      artifact.assets.length === 0
        ? undefined
        : await this.uploadStaticAssets(scriptName, artifact, directory);
    const modules = [];
    for (const module of artifact.modules) {
      const root = ["_headers", "_redirects"].includes(module.path)
        ? "client"
        : "server";
      // oxlint-disable-next-line no-await-in-loop -- Send only the verified compiled bytes, including routing metadata.
      const body = await readArtifactFile(path.join(directory, root), module);
      modules.push({
        content_base64: body.toString("base64"),
        content_type: module.contentType,
        name: module.path,
      });
    }
    const metadata = {
      annotations: {
        "workers/message": `source ${artifact.sourceSha}`,
        "workers/tag": digest,
      },
      ...(assetToken === undefined
        ? {}
        : { assets: { config: artifact.assetRouting, jwt: assetToken } }),
      bindings: baseline.bindings.map((binding) =>
        binding.type === "assets"
          ? { name: binding.name, type: "assets" }
          : {
              name: binding.name,
              type: "inherit",
              version_id: baselineVersionId,
            }
      ),
      compatibility_date: artifact.compatibilityDate,
      compatibility_flags: artifact.compatibilityFlags,
      limits: baseline.limits,
      main_module: artifact.mainModule,
      modules,
      placement: baseline.placement,
    };
    const latest = await this.active(scriptName);
    if (latest.id !== before.id || latest.versionId !== before.versionId) {
      throw new Error("Active deployment changed while preparing the upload.");
    }
    const version = z
      .object({
        bindings: z.array(
          z.object({ name: identifierSchema, type: z.string() })
        ),
        id: z.uuid(),
      })
      .parse(
        await this.call(null, `workers/${scriptName}/versions?deploy=false`, {
          body: JSON.stringify(metadata),
          method: "POST",
        })
      );
    const expectedBindings = baseline.bindings.toSorted((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (
      JSON.stringify(
        version.bindings.toSorted((a, b) => a.name.localeCompare(b.name))
      ) !== JSON.stringify(expectedBindings)
    ) {
      throw new Error(
        "The uploaded version did not preserve all binding names and types."
      );
    }
    const after = await this.active(scriptName);
    if (after.id !== before.id || after.versionId !== before.versionId) {
      throw new Error(
        "Active deployment changed during inactive upload. Reconcile before promotion."
      );
    }
    return { artifactDigest: digest, versionId: version.id };
  }

  private async uploadStaticAssets(
    scriptName: string,
    artifact: WorkerArtifact,
    directory: string
  ) {
    const manifest: Record<string, { hash: string; size: number }> = {};
    const files = new Map<string, WorkerArtifact["assets"][number]>();
    for (const file of artifact.assets) {
      // oxlint-disable-next-line no-await-in-loop -- The documented direct-upload hash includes bytes and extension.
      const body = await readArtifactFile(path.join(directory, "client"), file);
      const hash = createHash("sha256")
        .update(body.toString("base64") + path.extname(file.path).slice(1))
        .digest("hex")
        .slice(0, 32);
      manifest[`/${file.path}`] = { hash, size: file.bytes };
      const existing = files.get(hash);
      if (
        existing !== undefined &&
        (existing.digest !== file.digest ||
          existing.contentType !== file.contentType)
      ) {
        throw new Error("Static asset upload hash collision.");
      }
      files.set(hash, file);
    }
    const session = z
      .object({
        buckets: z.array(z.array(z.string().regex(/^[a-f\d]{32}$/u))),
        jwt: z.string().min(1),
      })
      .parse(
        await this.call(scriptName, "assets-upload-session", {
          body: JSON.stringify({ manifest }),
          method: "POST",
        })
      );
    if (session.buckets.length === 0) {
      return session.jwt;
    }
    let completion: string | undefined;
    for (const bucket of session.buckets) {
      const form = new FormData();
      let bytes = 0;
      for (const hash of bucket) {
        const file = files.get(hash);
        if (file === undefined) {
          throw new Error("The provider requested an unknown asset.");
        }
        bytes += file.bytes;
        if (bytes > 100_000_000) {
          throw new Error(
            "The provider's asset batch exceeds the memory bound."
          );
        }
        // oxlint-disable-next-line no-await-in-loop -- Verify bytes again immediately before upload.
        const body = await readArtifactFile(
          path.join(directory, "client"),
          file
        );
        form.append(
          hash,
          new File([body.toString("base64")], hash, { type: file.contentType })
        );
      }
      const result = z.object({ jwt: z.string().optional() }).parse(
        // oxlint-disable-next-line no-await-in-loop -- Follow the provider's bounded upload batches.
        await this.call(
          null,
          "assets/upload?base64=true",
          { body: form, method: "POST" },
          session.jwt
        )
      );
      if (result.jwt !== undefined) {
        completion = result.jwt;
      }
    }
    if (completion === undefined) {
      throw new Error("Static assets were not completely uploaded.");
    }
    return completion;
  }

  private async call(
    scriptName: string | null,
    suffix: string,
    init: RequestInit = {},
    token = this.token
  ) {
    if (scriptName !== null) {
      identifierSchema.parse(scriptName);
    }
    const response = await this.request(
      scriptName === null
        ? `${this.base.slice(0, -8)}/${suffix}`
        : `${this.base}/${scriptName}/${suffix}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      const error = z
        .object({ errors: z.array(z.object({ code: z.number() })) })
        .safeParse(await response.json().catch(() => null));
      throw new Error(
        `Cloudflare release operation failed with HTTP ${response.status}, codes ${error.success ? error.data.errors.map((entry) => entry.code).join(",") : "unavailable"}.`
      );
    }
    const envelope = z
      .object({ result: z.unknown(), success: z.literal(true) })
      .safeParse(await response.json());
    if (!envelope.success) {
      throw new Error("Cloudflare returned an invalid release response.");
    }
    return envelope.data.result;
  }
}
