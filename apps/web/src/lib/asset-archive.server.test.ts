import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  readArchivedAsset,
  serveArchivedAssetRequest,
} from "./asset-archive.server";

type ArchivedObject = {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata: (headers: Headers) => void;
};

type AssetArchive = { get: (key: string) => Promise<ArchivedObject | null> };

const workerEnv = vi.hoisted(() => ({
  WebAssetArchive: undefined as AssetArchive | undefined,
}));
const reportServerError = vi.hoisted(() =>
  vi.fn<(error: unknown, boundary: string) => void>()
);

vi.mock(import("cloudflare:workers"), () => ({ env: workerEnv }));
vi.mock(import("#/lib/server-error-reporting"), () => ({ reportServerError }));

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
    reportServerError.mockReset();
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
    expect(reportServerError).toHaveBeenCalledWith(
      expect.any(Error),
      "web-asset-archive-read"
    );
  });
});

describe(serveArchivedAssetRequest, () => {
  afterEach(() => {
    workerEnv.WebAssetArchive = undefined;
  });

  test("serves an archived asset without continuing the request chain", async () => {
    workerEnv.WebAssetArchive = archiveReturning(
      archivedObject("text/javascript; charset=utf-8")
    );
    const next = vi.fn<() => Promise<Response>>();

    const response = await serveArchivedAssetRequest(
      new Request("https://quieter.email/assets/old-abcdefgh.js"),
      next
    );

    expect(response).toBeInstanceOf(Response);
    expect(next).not.toHaveBeenCalled();
  });

  test("serves archived asset headers without a body for HEAD", async () => {
    workerEnv.WebAssetArchive = archiveReturning(
      archivedObject("text/javascript; charset=utf-8")
    );
    const next = vi.fn<() => Promise<Response>>();

    const response = await serveArchivedAssetRequest(
      new Request("https://quieter.email/assets/old-abcdefgh.js", {
        method: "HEAD",
      }),
      next
    );

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
      throw new TypeError("Expected an archived asset response");
    }
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toBe("");
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ["POST", "/assets/old.js"],
    ["GET", "/api/v1/send"],
    ["GET", "/assets/random"],
  ])("continues %s requests to %s", async (method, pathname) => {
    const downstream = new Response("next");
    const next = vi.fn<() => Promise<Response>>().mockResolvedValue(downstream);

    const response = await serveArchivedAssetRequest(
      new Request(`https://quieter.email${pathname}`, { method }),
      next
    );

    expect(response).toBe(downstream);
    expect(next).toHaveBeenCalledOnce();
  });
});
