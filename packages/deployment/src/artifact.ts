import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { assetManifestSchema } from "./assets.ts";
import { digestSchema, identifierSchema } from "./schema.ts";

const fileSchema = z.strictObject({
  bytes: z.number().int().min(0).max(25_000_000),
  contentType: z.string().min(1),
  digest: digestSchema,
  path: z
    .string()
    .regex(/^[\w./-]+$/u)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value
          .split("/")
          .some((part) => part === "" || part === "." || part === "..")
    ),
});
export const assetRoutingSchema = z.object({
  html_handling: z
    .enum([
      "auto-trailing-slash",
      "force-trailing-slash",
      "drop-trailing-slash",
      "none",
    ])
    .default("auto-trailing-slash"),
  not_found_handling: z
    .enum(["none", "404-page", "single-page-application"])
    .default("none"),
  run_worker_first: z.union([z.boolean(), z.array(z.string())]).default(false),
});
export const buildProvenanceSchema = z.strictObject({
  buildConfigDigest: digestSchema,
  command: z.literal("vp run --no-cache @quieter/web#build"),
  lockfileDigest: digestSchema,
  nodeVersion: z.string().regex(/^v\d+\.\d+\.\d+$/u),
  publicConfigurationDigest: digestSchema,
  sourceMaps: z
    .array(
      fileSchema.extend({
        contentType: z.literal("application/json"),
        path: fileSchema.shape.path.refine((value) =>
          /^(?:client|server)\/.+\.map$/u.test(value)
        ),
      })
    )
    .min(1)
    .max(4000),
  sourceTree: z.string().regex(/^[a-f\d]{40}$/u),
  stage: identifierSchema,
  toolchain: z.string().min(1).max(4000),
});
export const artifactSchema = z
  .strictObject({
    assetRouting: assetRoutingSchema,
    assets: z.array(fileSchema).max(20_000),
    buildId: identifierSchema,
    compatibilityDate: z.iso.date(),
    compatibilityFlags: z.array(identifierSchema),
    mainModule: z.literal("index.js"),
    modules: z.array(fileSchema).min(1).max(2000),
    provenance: buildProvenanceSchema.optional(),
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    sourceSha: z.string().regex(/^[a-f\d]{40}$/u),
  })
  .superRefine((artifact, context) => {
    if (
      (artifact.schemaVersion === 2) !==
      (artifact.provenance !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Artifact version does not match its build provenance.",
      });
    }
    const sourceMaps = artifact.provenance?.sourceMaps ?? [];
    if (
      new Set(sourceMaps.map((file) => file.path)).size !== sourceMaps.length ||
      sourceMaps.reduce((bytes, file) => bytes + file.bytes, 0) > 200_000_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid private source-map inventory.",
      });
    }
    if (
      artifact.modules.reduce((bytes, file) => bytes + file.bytes, 0) >
      64_000_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Compiled modules exceed the bounded upload size.",
      });
    }
    for (const files of [artifact.assets, artifact.modules]) {
      if (new Set(files.map((file) => file.path)).size !== files.length) {
        context.addIssue({
          code: "custom",
          message: "Duplicate artifact paths.",
        });
      }
    }
    if (!artifact.modules.some((file) => file.path === artifact.mainModule)) {
      context.addIssue({ code: "custom", message: "Missing main module." });
    }
  });
export type WorkerArtifact = z.infer<typeof artifactSchema>;

export const releaseArtifactSchema = z
  .strictObject({
    archive: assetManifestSchema.nullable(),
    artifact: artifactSchema,
    digest: digestSchema,
  })
  .superRefine((release, context) => {
    const digest = createHash("sha256")
      .update(JSON.stringify(release.artifact))
      .digest("hex");
    if (
      digest !== release.digest ||
      (release.archive !== null &&
        (release.archive.artifactDigest !== digest ||
          release.archive.buildId !== release.artifact.buildId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Release artifact and archive identity differ.",
      });
    }
    const expected = release.artifact.assets.filter(
      (file) =>
        file.path.startsWith("assets/") && file.path !== "assets/build-id.txt"
    );
    if (
      (expected.length === 0 && release.archive !== null) ||
      (expected.length > 0 &&
        JSON.stringify(expected) !== JSON.stringify(release.archive?.files))
    ) {
      context.addIssue({
        code: "custom",
        message: "The archive does not cover the artifact's browser assets.",
      });
    }
  });
export type ReleaseArtifact = z.infer<typeof releaseArtifactSchema>;

const publicContentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};

export const inventoryWorkerArtifact = async (
  directory: string,
  buildId: string,
  sourceSha: string,
  provenance?: z.infer<typeof buildProvenanceSchema>
) => {
  const config = z
    .object({
      assets: assetRoutingSchema.optional(),
      compatibility_date: z.iso.date(),
      compatibility_flags: z.array(identifierSchema),
    })
    .parse(
      JSON.parse(
        await readFile(path.join(directory, "server/wrangler.json"), "utf-8")
      )
    );
  const modules: WorkerArtifact["modules"] = [];
  const assets: WorkerArtifact["assets"] = [];
  const pending = ["server", "client"];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- Inspect the exact built tree with bounded memory.
    const entries = await readdir(path.join(directory, current), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error("Release artifacts cannot contain symlinks.");
      }
      if (
        entry.name.startsWith(".") ||
        entry.name === "wrangler.json" ||
        entry.name.endsWith(".map")
      ) {
        continue;
      }
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error("Unexpected artifact entry.");
      }
      const client = current.startsWith("client");
      const routing =
        current === "client" && ["_headers", "_redirects"].includes(entry.name);
      const extension = path.extname(entry.name);
      if (!client && ![".js", ".mjs", ".wasm"].includes(extension)) {
        continue;
      }
      let contentType =
        extension === ".wasm"
          ? "application/wasm"
          : "application/javascript+module";
      if (client) {
        contentType = routing ? "text/plain" : publicContentTypes[extension];
      }
      if (contentType === undefined) {
        throw new Error(`Unsupported artifact type: ${relative}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Hash one file at a time.
      const body = await readFile(path.join(directory, relative));
      (client && !routing ? assets : modules).push({
        bytes: body.byteLength,
        contentType,
        digest: createHash("sha256").update(body).digest("hex"),
        path: routing ? entry.name : relative.slice(7),
      });
    }
  }
  const artifact = artifactSchema.parse({
    assetRouting: assetRoutingSchema.parse(config.assets ?? {}),
    assets: assets.toSorted((a, b) => a.path.localeCompare(b.path)),
    buildId,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    mainModule: "index.js",
    modules: modules.toSorted((a, b) => a.path.localeCompare(b.path)),
    schemaVersion: provenance === undefined ? 1 : 2,
    sourceSha,
    ...(provenance === undefined ? {} : { provenance }),
  });
  return {
    artifact,
    digest: createHash("sha256").update(JSON.stringify(artifact)).digest("hex"),
  };
};

export const readArtifactFile = async (
  directory: string,
  file: z.infer<typeof fileSchema>
) => {
  const validated = fileSchema.parse(file);
  const body = await readFile(path.join(directory, validated.path));
  if (
    body.byteLength !== validated.bytes ||
    createHash("sha256").update(body).digest("hex") !== validated.digest
  ) {
    throw new Error("Artifact bytes changed after verification.");
  }
  return body;
};
