import { expoClient } from "@better-auth/expo/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { apiUrl } from "./env";

/**
 * The session cookie is persisted in SecureStore by the Expo plugin and is
 * attached to oRPC requests through `authClient.getCookie()`.
 */
export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [
    expoClient({
      scheme: "quieter",
      storage: SecureStore,
      storagePrefix: "quieter",
    }),
    organizationClient(),
  ],
});

export const getSessionCookie = async () => {
  try {
    return await authClient.getCookie();
  } catch {
    return "";
  }
};
