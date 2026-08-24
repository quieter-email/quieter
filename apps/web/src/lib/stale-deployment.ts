/**
 * Cloudflare replaces the whole asset manifest on deploy, so a tab opened
 * before a release keeps requesting hashed chunks that no longer exist. The
 * Worker answers those with the SPA shell, the browser refuses the `text/html`
 * module, and the lazy import rejects into the root error screen.
 *
 * Reloading fixes that, but only for that cause. A chunk can also fail because
 * the network dropped or the deployment is genuinely broken, and reloading
 * there costs the user their in-flight state only to land on the same error
 * screen. So staleness is a fact we establish, never a guess: the build id
 * baked into this bundle is compared against the one the current deployment
 * serves, and nothing reloads unless the two actually differ.
 */
const buildIdUrl = "/assets/build-id.txt";
const reloadedForBuildKey = "quieter:reloaded-for-build";

/** Non-null only once a check has proven this bundle is behind the deployment. */
let staleBuildId: string | null = null;
let inFlightCheck: Promise<string | null> | null = null;

/**
 * Resolves to the deployed build id when it differs from ours, otherwise null.
 *
 * A missing or non-plaintext body means the answer is unknown rather than
 * stale. That guard carries the weight here: an asset 404 falls through to the
 * SPA shell, and reading that HTML as a mismatch would reload on exactly the
 * genuine failures this is meant to leave alone. It also makes the dev server,
 * which serves no build id file at all, a no-op.
 */
export const detectNewDeployment = async () => {
  let response: Response;
  try {
    response = await fetch(buildIdUrl, { cache: "no-store" });
  } catch {
    return null;
  }

  const contentType = response.headers.get("content-type");
  if (
    !response.ok ||
    contentType === null ||
    !contentType.includes("text/plain")
  ) {
    return null;
  }

  const body = await response.text();
  const deployedBuildId = body.trim();
  staleBuildId =
    deployedBuildId !== "" && deployedBuildId !== __QUIETER_BUILD_ID__
      ? deployedBuildId
      : null;

  return staleBuildId;
};

/** Shared so a burst of checks costs one request. */
const refreshDeploymentState = async () => {
  inFlightCheck ??= detectNewDeployment();
  try {
    return await inFlightCheck;
  } finally {
    inFlightCheck = null;
  }
};

/**
 * One reload per deployment we move to. If the replacement bundle fails the
 * same way, the build ids now match and the failure reads as genuine.
 */
const canReloadFor = (deployedBuildId: string) =>
  window.sessionStorage.getItem(reloadedForBuildKey) !== deployedBuildId;

const reloadFor = (deployedBuildId: string) => {
  window.sessionStorage.setItem(reloadedForBuildKey, deployedBuildId);
  window.location.reload();
};

const reloadIfDeploymentChanged = async () => {
  const deployedBuildId = await refreshDeploymentState();
  if (deployedBuildId !== null && canReloadFor(deployedBuildId)) {
    reloadFor(deployedBuildId);
  }
};

export const installStaleDeploymentRecovery = () => {
  // Returning to a long-open tab is when a release is most likely to have
  // landed underneath it, so staleness is usually already known by the time a
  // chunk fails. Detection only: reloading someone who is browsing happily
  // would throw away the draft they came back to finish.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshDeploymentState();
    }
  });

  window.addEventListener("vite:preloadError", (event) => {
    if (staleBuildId !== null && canReloadFor(staleBuildId)) {
      // Already proven stale, so suppress the throw: the error screen would
      // only flash before the reload replaced it.
      event.preventDefault();
      reloadFor(staleBuildId);
      return;
    }

    // Cause unknown. Let the failure surface now rather than reloading on a
    // hunch, and reload only once the check comes back stale.
    void reloadIfDeploymentChanged();
  });
};
