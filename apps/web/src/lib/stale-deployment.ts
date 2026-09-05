import { useSyncExternalStore } from "react";

import { isDeploymentAssetError } from "./deployment-errors";

let updateRequired = false;
const listeners = new Set<() => void>();

export const handleDeploymentPreloadError = (event: Event) => {
  if (!("payload" in event && isDeploymentAssetError(event.payload))) {
    return;
  }

  // Let the original rejection reach the route boundary. Cancelling it makes
  // Vite return undefined, causing misleading errors in lazy module loaders.
  updateRequired = true;
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useDeploymentUpdateRequired = () =>
  useSyncExternalStore(
    subscribe,
    () => updateRequired,
    () => false
  );
