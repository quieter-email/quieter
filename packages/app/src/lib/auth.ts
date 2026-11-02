"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { electronProxyClient } from "@better-auth/electron/proxy";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_CLIENT_ID,
  DESKTOP_AUTH_PROTOCOL_SCHEME,
} from "@quieter/auth/desktop";
import {
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { appFetch } from "../runtime";
import { draftRecoveryJournal } from "./draft-recovery-journal";
import { captureQueryPersistenceCleanup } from "./query-persister";

const createAppAuthClient = (options: { baseURL?: string } = {}) => {
  const currentURL =
    options.baseURL ??
    (typeof window === "undefined" ? undefined : window.location.href);
  const customOrigin =
    currentURL && !/^https?:/u.test(currentURL) ? new URL(currentURL) : null;

  return createAuthClient({
    baseURL:
      customOrigin === null
        ? options.baseURL
        : "https://quieter-desktop.invalid/api/auth",
    fetchOptions: {
      customFetchImpl:
        customOrigin === null
          ? appFetch
          : async (input, init) => {
              const url = new URL(
                input instanceof Request ? input.url : input.toString()
              );
              const destination = new URL(
                `${url.pathname}${url.search}`,
                customOrigin
              );
              return await appFetch(
                input instanceof Request
                  ? new Request(destination, input)
                  : destination,
                init
              );
            },
    },
    plugins: [
      passkeyClient(),
      organizationClient(),
      apiKeyClient(),
      lastLoginMethodClient(),
      magicLinkClient(),
      electronProxyClient({
        callbackPath: DESKTOP_AUTH_CALLBACK_PATH,
        clientID: DESKTOP_AUTH_CLIENT_ID,
        protocol: { scheme: DESKTOP_AUTH_PROTOCOL_SCHEME },
      }),
    ],
  });
};

// oxlint-disable-next-line import/no-mutable-exports -- Each app configures the client transport before rendering shared account UI.
export let authClient = createAppAuthClient();

export const configureAppAuthClient = (options: { baseURL: string }) => {
  authClient = createAppAuthClient(options);
};

export const signOut = async () => {
  const clearQueries = captureQueryPersistenceCleanup();
  const clearRecovery = draftRecoveryJournal.captureCleanup();
  if (!(clearQueries && clearRecovery) || !(await clearQueries.isCurrent())) {
    throw new Error("Your session is still loading. Please try again.");
  }
  const response = await authClient.signOut();
  if (response.error) {
    throw new Error(response.error.message ?? "Could not sign out.", {
      cause: response.error,
    });
  }
  const results = await Promise.allSettled([clearRecovery(), clearQueries()]);
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result): unknown => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Local sign-out cleanup failed.");
  }
  return response;
};
