import { useSyncExternalStore } from "react";

import { isDeploymentAssetError } from "./deployment-errors";

let updateRequired = false;
const listeners = new Set<() => void>();
let checking = false;

export const checkForDeploymentUpdate = async () => {
  if (checking || updateRequired) {
    return;
  }
  checking = true;
  try {
    const response = await fetch("/assets/build-id.txt", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.includes("text/plain") !== true
    ) {
      return;
    }
    const markerText = await response.text();
    const buildId = markerText.trim();
    if (!/^[\w.-]{1,128}$/u.test(buildId) || buildId === __QUIETER_BUILD_ID__) {
      return;
    }
    updateRequired = true;
    for (const listener of listeners) {
      listener();
    }
  } catch {
    // An offline tab or a failed request does not prove a new release exists.
  } finally {
    checking = false;
  }
};

export const handleDeploymentPreloadError = (event: Event) => {
  if (!("payload" in event && isDeploymentAssetError(event.payload))) {
    return;
  }

  // Let the original rejection reach the route boundary. Cancelling it makes
  // Vite return undefined, causing misleading errors in lazy module loaders.
  void checkForDeploymentUpdate();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const check = () => {
    if (document.visibilityState === "visible") {
      void checkForDeploymentUpdate();
    }
  };
  const timer = window.setInterval(check, 60_000);
  window.addEventListener("focus", check);
  check();
  return () => {
    listeners.delete(listener);
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
  };
};

export const useDeploymentUpdateRequired = () =>
  useSyncExternalStore(
    subscribe,
    () => updateRequired,
    () => false
  );
