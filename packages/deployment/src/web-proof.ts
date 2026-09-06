import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { releaseArtifactSchema } from "./artifact.ts";
import type { CloudflareRuntimeProvider } from "./cloudflare.ts";
import type { ActiveDeployment } from "./schema.ts";

export const verifyWebCandidate = async (input: {
  artifactDigest: string;
  baseline: ActiveDeployment;
  directory: string;
  provider: CloudflareRuntimeProvider;
  publicUrl: string;
  scriptName: string;
  token: string;
  versionId: string;
}) => {
  const manifest = releaseArtifactSchema.parse(
    JSON.parse(
      await readFile(path.join(input.directory, "artifact.json"), "utf-8")
    )
  );
  assert.equal(manifest.digest, input.artifactDigest);
  const { archive } = manifest;
  assert.ok(archive);
  await input.provider.verifyArtifact(
    input.scriptName,
    input.versionId,
    manifest.artifact
  );
  const preview = new URL(input.publicUrl);
  preview.hostname = `${input.versionId.slice(0, 8)}-${preview.hostname}`;
  const headers = {
    accept: "text/html",
    authorization: `Bearer ${input.token}`,
  };
  const denied = await fetch(new URL("/terms", preview), {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(denied.status, 404);
  await denied.body?.cancel();
  const mutation = await fetch(new URL("/api/v1/send", preview), {
    headers,
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(mutation.status, 405);
  await mutation.body?.cancel();
  const page = await fetch(new URL("/terms", preview), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const html = await page.text();
  await writeFile(path.join(input.directory, "terms.html"), html);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/u);
  assert.match(html, /<html/u);
  assert.match(html, /Terms/u);
  const browserFiles = [".js", ".css", ".woff2"].map((extension) => {
    const file = archive.files.find((entry) => entry.path.endsWith(extension));
    if (file === undefined) {
      throw new Error(`The web proof has no ${extension} fixture.`);
    }
    return file;
  });
  await Promise.all(
    browserFiles.map(async (file) => {
      // oxlint-disable-next-line no-await-in-loop -- Confirm static assets cannot bypass the outer preview guard.
      const deniedAsset = await fetch(new URL(`/${file.path}`, preview), {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(deniedAsset.status, 404);
      // oxlint-disable-next-line no-await-in-loop -- Release the denied response before the authenticated check.
      await deniedAsset.body?.cancel();
      // oxlint-disable-next-line no-await-in-loop -- Verify each browser asset kind with bounded requests.
      const asset = await fetch(new URL(`/${file.path}`, preview), {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(asset.status, 200);
      const contentType = asset.headers.get("content-type")?.split(";")[0];
      assert.ok(
        file.path.endsWith(".js")
          ? ["application/javascript", "text/javascript"].includes(
              contentType ?? ""
            )
          : contentType === file.contentType.split(";")[0]
      );
      // oxlint-disable-next-line no-await-in-loop -- Compare binary font bytes as well as JavaScript and CSS.
      const actual = Buffer.from(await asset.arrayBuffer());
      // oxlint-disable-next-line no-await-in-loop -- Read only the fixture file named by the validated manifest.
      const expected = await readFile(
        path.join(input.directory, "client", file.path)
      );
      assert.deepEqual(actual, expected);
    })
  );
  assert.deepEqual(
    await input.provider.active(input.scriptName),
    input.baseline
  );
};
