import { createOrpcClient } from "@quieter/orpc";
import { createQueryApi } from "@quieter/query";

import { getSessionCookie } from "./auth-client";
import { apiUrl } from "./env";

export const rpc = createOrpcClient({
  headers: async (): Promise<Record<string, string>> => {
    const cookie = await getSessionCookie();
    return cookie.length > 0 ? { Cookie: cookie } : {};
  },
  url: `${apiUrl}/api/orpc`,
});

export const api = createQueryApi(rpc);
