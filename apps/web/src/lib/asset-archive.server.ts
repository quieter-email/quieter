import { env } from "cloudflare:workers";

import { reportServerError } from "./server-error-reporting";

/**
 * A deploy replaces the Worker asset manifest wholesale, so hashed chunks from
 * the previous release stop resolving and a tab opened before it fails on its
 * next lazy import. Every build's assets are archived to R2, and this serves
 * them when the live manifest no longer has the file.
 *
 * Only reached on a miss: assets that are still current are served by the
 * asset manifest without ever invoking the Worker.
 */
export const readArchivedAsset = async (pathname: string, head = false) => {
  const archive = env.WebAssetArchive;
  if (archive === undefined) {
    return null;
  }

  // Hashed filenames are content addressed, so an archived object under this
  // key is byte-for-byte the file the stale tab asked for.
  const object = await archive
    .get(pathname.slice(1))
    .catch((error: unknown) => {
      reportServerError(error, "web-asset-archive-read");
      return null;
    });
  if (object === null) {
    return null;
  }

  const headers = new Headers();
  // Carries the content type stored at upload. Without it the browser refuses
  // the module, which is the failure this exists to prevent.
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("etag", object.httpEtag);

  return new Response(head ? null : object.body, { headers, status: 200 });
};

export const serveArchivedAssetRequest = async <T>(
  request: Request,
  next: () => Promise<T>
): Promise<Response | T> => {
  const { pathname } = new URL(request.url);
  const isArchivedAsset =
    /^\/assets\/(?:releases\/[\w.-]{1,128}\.txt|[\w.-]+-[\w-]{8,}\.(?:css|js|woff2))$/u.test(
      pathname
    );
  if (!["GET", "HEAD"].includes(request.method) || !isArchivedAsset) {
    return await next();
  }

  return (
    (await readArchivedAsset(pathname, request.method === "HEAD")) ??
    (await next())
  );
};
