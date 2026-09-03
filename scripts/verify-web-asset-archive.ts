import process from "node:process";

const productionOrigin = "https://quieter.email";
const expectedBuildId = process.env.QUIETER_BUILD_ID ?? null;
const allowBootstrap =
  process.env.QUIETER_ALLOW_WEB_ASSET_ARCHIVE_BOOTSTRAP === "true";
const strict = process.env.QUIETER_WEB_ASSET_ARCHIVE_VERIFY_MODE === "strict";

const buildIdResponse = await fetch(
  new URL("/assets/build-id.txt", productionOrigin),
  { cache: "no-store" }
);
if (
  !buildIdResponse.ok &&
  !(buildIdResponse.status === 404 && allowBootstrap)
) {
  throw new Error(
    `Could not read the production build id: HTTP ${buildIdResponse.status}.`
  );
}

const buildIdContentType = buildIdResponse.headers.get("content-type");
if (buildIdResponse.ok && buildIdContentType?.includes("text/plain") === true) {
  const buildIdBody = await buildIdResponse.text();
  const buildId = buildIdBody.trim();
  if (!/^[\w.-]{1,128}$/u.test(buildId)) {
    throw new Error("The production build id is empty or malformed.");
  }

  const markerResponse = await fetch(
    new URL(
      `/assets/releases/${encodeURIComponent(buildId)}.txt`,
      productionOrigin
    ),
    { cache: "no-store" }
  );
  const markerBody = markerResponse.ok ? await markerResponse.text() : null;
  const marker = markerBody?.trim() ?? null;
  if (strict && buildId !== expectedBuildId) {
    throw new Error(
      `Expected deployed build ${expectedBuildId ?? "unknown"}, but production serves ${buildId}.`
    );
  }
  if (marker !== buildId && (strict || buildId !== expectedBuildId)) {
    throw new Error(
      `Production build ${buildId} is not fully archived. Rerun its failed deployment before replacing it.`
    );
  }

  process.stdout.write(
    marker === buildId
      ? `Verified archived production build ${buildId}.\n`
      : `Allowing same-build repair for unarchived production build ${buildId}.\n`
  );
} else {
  if (!allowBootstrap || strict) {
    throw new Error(
      "Production did not return a plaintext web build id. Use the explicit bootstrap deployment only for the first archive-aware release."
    );
  }
  process.stdout.write(
    "Production predates asset archive markers; skipping the one-time preflight.\n"
  );
}
