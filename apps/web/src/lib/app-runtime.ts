import { configureAppOrpcClient } from "@quieter/app/lib/orpc";
import { configureAppRuntime } from "@quieter/app/runtime";
import { createOrpcClient } from "@quieter/orpc";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";

import { deploymentFetch } from "./stale-deployment";

const getOrpcClient = createIsomorphicFn()
  .server(() =>
    createOrpcClient({
      headers: () => Object.fromEntries(getRequestHeaders()),
      url: () => new URL("/api/orpc", getRequest().url),
    })
  )
  .client(() => {
    configureAppRuntime({ fetch: deploymentFetch });
    return createOrpcClient({
      fetch: deploymentFetch,
      url: `${window.location.origin}/api/orpc`,
    });
  });

configureAppOrpcClient(getOrpcClient());
