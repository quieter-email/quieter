"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    organizationClient(),
    apiKeyClient(),
    lastLoginMethodClient(),
    magicLinkClient(),
  ],
});
