import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { readArchivedAsset } from "./asset-archive.server";

type ArchivedObject = {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata: (headers: Headers) => void;
};

type AssetArchive = { get: (key: string) => Promise<ArchivedObject | null> };

const workerEnv = vi.hoisted(() => ({
  WebAssetArchive: undefined as AssetArchive | undefined,
}));

vi.mock(import("cloudflare:workers"), () => ({ env: workerEnv }));

const archivedObject = (contentType: string): ArchivedObject => ({
  body: new Blob(["export const chunk = 1;"]).stream(),
  httpEtag: '"abc123"',
  writeHttpMetadata: (headers) => {
    headers.set("content-type", contentType);
  },
});

const archiveReturning = (object: ArchivedObject | null) => ({
  get: vi.fn<AssetArchive["get"]>().mockResolvedValue(object),
});

describe(readArchivedAsset, () => {
  afterEach(() => {
    workerEnv.WebAssetArchive = undefined;
  });

  test("serves an archived chunk with the content type it was stored with", async () => {
    workerEnv.WebAssetArchive = archiveReturning(
      archivedObject("text/javascript; charset=utf-8")
    );

    const response = await readArchivedAsset("/assets/chat-view-sVSw.js");

    expect(response?.status).toBe(200);
    // Without this the browser refuses the module, which is the whole failure
    // this path exists to prevent.
    expect(response?.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8"
    );
    expect(response?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response?.headers.get("etag")).toBe('"abc123"');
  });

  test("looks the object up under the path without its leading slash", async () => {
    const archive = archiveReturning(archivedObject("text/css; charset=utf-8"));
    workerEnv.WebAssetArchive = archive;

    await readArchivedAsset("/assets/styles-abc.css");

    expect(archive.get).toHaveBeenCalledWith("assets/styles-abc.css");
  });

  test("falls through when the archive has no such object", async () => {
    workerEnv.WebAssetArchive = archiveReturning(null);

    await expect(readArchivedAsset("/assets/gone.js")).resolves.toBeNull();
  });

  test("falls through when the binding is absent", async () => {
    await expect(readArchivedAsset("/assets/anything.js")).resolves.toBeNull();
  });

  test("falls through when the archive lookup fails", async () => {
    workerEnv.WebAssetArchive = {
      get: vi
        .fn<AssetArchive["get"]>()
        .mockRejectedValue(new Error("r2 unavailable")),
    };

    await expect(readArchivedAsset("/assets/anything.js")).resolves.toBeNull();
  });
});
