import { configureAppOrpcClient } from "@quieter/app/lib/orpc";
import { createOrpcClient } from "@quieter/orpc";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";

const getOrpcClient = createIsomorphicFn()
  .server(() =>
    createOrpcClient({
      headers: () => Object.fromEntries(getRequestHeaders()),
      url: () => new URL("/api/orpc", getRequest().url),
    })
  )
  .client(() =>
    createOrpcClient({
      url: `${window.location.origin}/api/orpc`,
    })
  );

configureAppOrpcClient(getOrpcClient());
