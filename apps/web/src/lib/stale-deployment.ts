/**
 * Cloudflare replaces the whole asset manifest on deploy, so a tab that was
 * opened before a release keeps a route tree pointing at hashed chunks that no
 * longer exist. The Worker answers those requests with the SPA shell, the
 * browser refuses the `text/html` module, and the lazy import rejects into the
 * root error screen. Reloading picks up the current shell; the timestamp guard
 * keeps a genuinely broken chunk from looping.
 */
const lastReloadKey = "quieter:stale-deployment-reload";
const reloadCooldownMs = 30_000;

export const installStaleDeploymentRecovery = () => {
  window.addEventListener("vite:preloadError", (event) => {
    const lastReloadAt = Number(
      window.sessionStorage.getItem(lastReloadKey) ?? "0"
    );
    if (Date.now() - lastReloadAt < reloadCooldownMs) {
      return;
    }

    event.preventDefault();
    window.sessionStorage.setItem(lastReloadKey, String(Date.now()));
    window.location.reload();
  });
};
