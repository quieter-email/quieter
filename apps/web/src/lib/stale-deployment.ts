import { isDeploymentAssetError } from "@quieter/app/lib/deployment-errors";
import {
  DEPLOYMENT_BUILD_HEADER,
  DEPLOYMENT_RELOAD_HEADER,
  DEPLOYMENT_STATUS_PATH,
  deploymentStatusSchema,
} from "@quieter/env/deployment";
import { useSyncExternalStore } from "react";

type DeploymentUpdateStatus = "current" | "available" | "required";

let status: DeploymentUpdateStatus = "current";
let retirementDeadline: number | null = null;
let checking = false;
let pollTimer: number | undefined;
const listeners = new Set<() => void>();

const setStatus = (next: DeploymentUpdateStatus) => {
  if (status === next) {
    return;
  }
  status = next;
  for (const listener of listeners) {
    listener();
  }
};

export const checkForDeploymentUpdate = async () => {
  if (retirementDeadline !== null && performance.now() >= retirementDeadline) {
    setStatus("required");
  }
  if (checking) {
    return;
  }
  checking = true;
  try {
    const response = await fetch(DEPLOYMENT_STATUS_PATH, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.includes("application/json") !==
        true
    ) {
      return;
    }
    const result = deploymentStatusSchema.safeParse(await response.json());
    if (!result.success) {
      return;
    }
    const deployment = result.data;
    if (deployment.current.buildId === __QUIETER_BUILD_ID__) {
      retirementDeadline = null;
      setStatus("current");
      return;
    }
    if (
      deployment.previous?.buildId === __QUIETER_BUILD_ID__ &&
      deployment.previous.expiresAt > deployment.serverTime
    ) {
      // Measure the grace period using the server clock, even if this device is wrong.
      const deadline =
        performance.now() +
        deployment.previous.expiresAt -
        deployment.serverTime;
      retirementDeadline =
        retirementDeadline === null
          ? deadline
          : Math.min(retirementDeadline, deadline);
      if (status !== "required") {
        setStatus("available");
      }
      return;
    }
    retirementDeadline = null;
    setStatus("required");
  } catch {
    // Offline requests do not establish that a release has changed or disappeared.
  } finally {
    checking = false;
  }
};

export const deploymentFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : input,
    window.location.origin
  );
  if (
    url.origin !== window.location.origin ||
    !(
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn/")
    )
  ) {
    return await fetch(input, init);
  }
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  headers.set(DEPLOYMENT_BUILD_HEADER, __QUIETER_BUILD_ID__);
  const response = await fetch(input, { ...init, headers });
  if (
    response.status === 409 &&
    response.headers.get(DEPLOYMENT_RELOAD_HEADER) === "1"
  ) {
    setStatus("required");
    await response.body?.cancel();
    throw Object.assign(new Error("Reload the site to continue."), {
      code: "DEPLOYMENT_RETIRED",
      status: 409,
    });
  }
  return response;
};

export const handleDeploymentPreloadError = (event: Event) => {
  if (!("payload" in event && isDeploymentAssetError(event.payload))) {
    return;
  }
  // Preserve the original rejection so lazy loaders reach their route boundary.
  void checkForDeploymentUpdate();
};

const checkForVisibleDeploymentUpdate = () => {
  if (document.visibilityState === "visible") {
    void checkForDeploymentUpdate();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    pollTimer = window.setInterval(checkForVisibleDeploymentUpdate, 60_000);
    window.addEventListener("focus", checkForVisibleDeploymentUpdate);
    window.addEventListener("online", checkForVisibleDeploymentUpdate);
    document.addEventListener(
      "visibilitychange",
      checkForVisibleDeploymentUpdate
    );
    checkForVisibleDeploymentUpdate();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
      window.removeEventListener("focus", checkForVisibleDeploymentUpdate);
      window.removeEventListener("online", checkForVisibleDeploymentUpdate);
      document.removeEventListener(
        "visibilitychange",
        checkForVisibleDeploymentUpdate
      );
    }
  };
};

export const useDeploymentUpdateStatus = () =>
  useSyncExternalStore<DeploymentUpdateStatus>(
    subscribe,
    () => status,
    () => "current"
  );
