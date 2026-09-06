import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  inventoryWorkerArtifact,
  releaseArtifactSchema,
} from "../src/artifact.ts";
import { inventoryAssets } from "../src/assets.ts";
import { CloudflareRuntimeProvider } from "../src/cloudflare.ts";

const directories: string[] = [];
const baselineId = randomUUID();
const deploymentId = randomUUID();
const candidateId = randomUUID();
const deploymentResponse = () =>
  Response.json({
    result: {
      deployments: [
        {
          created_on: "2026-09-06T00:00:00Z",
          id: deploymentId,
          versions: [{ percentage: 100, version_id: baselineId }],
        },
      ],
    },
    success: true,
  });
const baselineResponse = () =>
  Response.json({
    result: {
      bindings: [
        { name: "TOKEN", type: "secret_text" },
        { name: "QUEUE", type: "queue" },
      ],
      compatibility_date: "2026-08-04",
      compatibility_flags: ["nodejs_compat"],
      id: baselineId,
    },
    success: true,
  });
const build = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "quieter-artifact-"));
  directories.push(directory);
  await Promise.all([
    mkdir(path.join(directory, "client")),
    mkdir(path.join(directory, "server")),
  ]);
  await Promise.all([
    writeFile(
      path.join(directory, "server/wrangler.json"),
      JSON.stringify({
        compatibility_date: "2026-08-04",
        compatibility_flags: ["nodejs_compat"],
        vars: { PRIVATE: "must-not-ship" },
      })
    ),
    writeFile(
      path.join(directory, "server/index.js"),
      "export default {fetch() { return new Response('proof'); }}"
    ),
    writeFile(
      path.join(directory, "server/index.js.map"),
      "private source map"
    ),
  ]);
  return {
    directory,
    ...(await inventoryWorkerArtifact(directory, "proof", "a".repeat(40))),
  };
};

describe("verified native uploads", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  it("compares provider module bytes with the tested artifact, including an SST main-module alias", async () => {
    const { artifact, directory } = await build();
    const module = await readFile(path.join(directory, "server/index.js"));
    const version = {
      compatibility_date: artifact.compatibilityDate,
      compatibility_flags: artifact.compatibilityFlags,
      id: baselineId,
      main_module: "placeholder",
      modules: [
        {
          content_base64: module.toString("base64"),
          content_type: "application/javascript+module",
          name: "placeholder",
        },
      ],
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: version, success: true }))
      .mockResolvedValueOnce(
        Response.json({
          result: {
            ...version,
            modules: [
              {
                ...version.modules[0],
                content_base64:
                  Buffer.from("different code").toString("base64"),
              },
            ],
          },
          success: true,
        })
      );
    const provider = new CloudflareRuntimeProvider(
      "a".repeat(32),
      "token",
      request
    );
    await provider.verifyArtifact("probe", baselineId, artifact);
    await expect(
      provider.verifyArtifact("probe", baselineId, artifact)
    ).rejects.toThrow("bytes differ");
    expect(request.mock.calls[0]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/workers/probe/versions/${baselineId}?include=modules`
    );
  });

  it("rejects incomplete archives and changed release identity", async () => {
    const { directory } = await build();
    await mkdir(path.join(directory, "client/assets"));
    await Promise.all([
      writeFile(
        path.join(directory, "client/assets/main-12345678.js"),
        "script"
      ),
      writeFile(
        path.join(directory, "client/assets/font-12345678.woff2"),
        "font"
      ),
    ]);
    const release = await inventoryWorkerArtifact(
      directory,
      "proof",
      "a".repeat(40)
    );
    const archive = await inventoryAssets(
      path.join(directory, "client"),
      "proof",
      release.digest
    );
    expect(
      releaseArtifactSchema.safeParse({ ...release, archive }).success
    ).toBeTruthy();
    for (const changed of [
      { ...release, archive, digest: "b".repeat(64) },
      { ...release, archive: { ...archive, buildId: "other-build" } },
      { ...release, archive: { ...archive, files: archive.files.slice(1) } },
      {
        ...release,
        archive: {
          ...archive,
          files: archive.files.map((file) => ({
            ...file,
            digest: "b".repeat(64),
          })),
        },
      },
      {
        ...release,
        archive,
        artifact: { ...release.artifact, sourceSha: "b".repeat(40) },
      },
    ]) {
      expect(releaseArtifactSchema.safeParse(changed).success).toBeFalsy();
    }
  });

  it("inherits bindings from the recorded version and never calls deployment APIs to write", async () => {
    const { artifact, directory, digest } = await build();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(baselineResponse())
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(
        Response.json({
          result: {
            bindings: [
              { name: "TOKEN", type: "secret_text" },
              { name: "QUEUE", type: "queue" },
            ],
            id: candidateId,
          },
          success: true,
        })
      )
      .mockResolvedValueOnce(deploymentResponse());
    const provider = new CloudflareRuntimeProvider(
      "a".repeat(32),
      "token",
      request
    );
    await expect(
      provider.uploadArtifact("probe", baselineId, artifact, directory)
    ).resolves.toStrictEqual({
      artifactDigest: digest,
      versionId: candidateId,
    });
    const uploads = request.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    );
    expect(uploads).toHaveLength(1);
    const [[url, init]] = uploads;
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/workers/probe/versions?deploy=false`
    );
    if (typeof init?.body !== "string") {
      throw new TypeError("Expected JSON upload.");
    }
    const metadata = init.body;
    expect(JSON.parse(metadata)).toMatchObject({
      annotations: { "workers/tag": digest },
      bindings: [
        { name: "TOKEN", type: "inherit", version_id: baselineId },
        { name: "QUEUE", type: "inherit", version_id: baselineId },
      ],
    });
    expect({
      parts: z
        .object({ modules: z.array(z.object({ name: z.string() })) })
        .parse(JSON.parse(metadata))
        .modules.map((module: { name: string }) => module.name),
      privateValue: metadata.includes("must-not-ship"),
    }).toStrictEqual({ parts: ["index.js"], privateValue: false });
  });

  it("rejects build mutation before creating an inactive version", async () => {
    const { artifact, directory } = await build();
    await writeFile(path.join(directory, "server/index.js"), "changed");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(baselineResponse());
    await expect(
      new CloudflareRuntimeProvider(
        "a".repeat(32),
        "token",
        request
      ).uploadArtifact("probe", baselineId, artifact, directory)
    ).rejects.toThrow("bytes changed");
    expect(
      request.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBeFalsy();
  });

  it("does not upload code when static asset completion is missing", async () => {
    const { directory } = await build();
    await writeFile(path.join(directory, "client/probe.txt"), "probe");
    const { artifact } = await inventoryWorkerArtifact(
      directory,
      "proof",
      "a".repeat(40)
    );
    const request = vi
      .fn<typeof fetch>()
      // oxlint-disable-next-line require-await -- The simulated provider implements the asynchronous fetch contract.
      .mockImplementation(async (input, init) => {
        if (typeof input !== "string") {
          throw new TypeError("Expected a provider URL string.");
        }
        const url = input;
        if (url.endsWith("/deployments")) {
          return deploymentResponse();
        }
        if (url.endsWith(`/versions/${baselineId}`)) {
          return Response.json({
            result: {
              assets: { config: artifact.assetRouting },
              bindings: [{ name: "ASSETS", type: "assets" }],
              compatibility_date: artifact.compatibilityDate,
              compatibility_flags: artifact.compatibilityFlags,
              id: baselineId,
            },
            success: true,
          });
        }
        if (
          url.endsWith("/assets-upload-session") &&
          typeof init?.body === "string"
        ) {
          const manifest = z
            .object({
              manifest: z.record(z.string(), z.object({ hash: z.string() })),
            })
            .parse(JSON.parse(init.body));
          return Response.json({
            result: {
              buckets: [[manifest.manifest["/probe.txt"].hash]],
              jwt: "temporary-upload-token",
            },
            success: true,
          });
        }
        if (url.endsWith("/assets/upload?base64=true")) {
          return Response.json({ result: {}, success: true });
        }
        throw new Error("Unexpected upload operation.");
      });
    await expect(
      new CloudflareRuntimeProvider(
        "a".repeat(32),
        "token",
        request
      ).uploadArtifact("probe", baselineId, artifact, directory)
    ).rejects.toThrow("not completely uploaded");
    const upload = request.mock.calls.find(
      ([url]) =>
        typeof url === "string" && url.endsWith("/assets/upload?base64=true")
    );
    expect(upload?.[1]?.headers).toMatchObject({
      authorization: "Bearer temporary-upload-token",
    });
    expect(
      request.mock.calls.some(
        ([url]) => typeof url === "string" && url.includes("deploy=false")
      )
    ).toBeFalsy();
  });

  it("rejects a provider response that dropped an inherited binding", async () => {
    const { artifact, directory } = await build();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(baselineResponse())
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(
        Response.json({
          result: {
            bindings: [{ name: "TOKEN", type: "secret_text" }],
            id: candidateId,
          },
          success: true,
        })
      );
    await expect(
      new CloudflareRuntimeProvider(
        "a".repeat(32),
        "token",
        request
      ).uploadArtifact("probe", baselineId, artifact, directory)
    ).rejects.toThrow("preserve all binding");
  });

  it("rejects runtime compatibility changes without uploading", async () => {
    const { artifact, directory } = await build();
    artifact.compatibilityDate = "2026-09-06";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(baselineResponse());
    await expect(
      new CloudflareRuntimeProvider(
        "a".repeat(32),
        "token",
        request
      ).uploadArtifact("probe", baselineId, artifact, directory)
    ).rejects.toThrow("infrastructure transition");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("detects drift while staging the upload", async () => {
    const { artifact, directory } = await build();
    const changed = Response.json({
      result: {
        deployments: [
          {
            created_on: "2026-09-06T00:00:01Z",
            id: randomUUID(),
            versions: [{ percentage: 100, version_id: randomUUID() }],
          },
        ],
      },
      success: true,
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deploymentResponse())
      .mockResolvedValueOnce(baselineResponse())
      .mockResolvedValueOnce(changed);
    await expect(
      new CloudflareRuntimeProvider(
        "a".repeat(32),
        "token",
        request
      ).uploadArtifact("probe", baselineId, artifact, directory)
    ).rejects.toThrow("changed while preparing");
    expect(
      request.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBeFalsy();
  });

  it("rejects split traffic before a routine upload", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        result: {
          deployments: [
            {
              created_on: "2026-09-06T00:00:00Z",
              id: deploymentId,
              versions: [
                { percentage: 50, version_id: baselineId },
                { percentage: 50, version_id: candidateId },
              ],
            },
          ],
        },
        success: true,
      })
    );
    await expect(
      new CloudflareRuntimeProvider("a".repeat(32), "token", request).active(
        "probe"
      )
    ).rejects.toThrow("Split deployments");
  });
});
