import "@tanstack/react-start/server-only";
import {
  getMcpConsentRequest,
  resumeMcpAuthorization,
} from "@quieter/auth/mcp-oauth";
import { getSessionWithOrganization } from "@quieter/auth/session";

import { getSessionUserForRequest } from "./auth.server";

export const getMcpLoginForRequest = async (
  request: Request,
  authorizationRequest: string
) => {
  const session = await getSessionWithOrganization(
    new Headers(request.headers)
  );
  return {
    continueTo: await resumeMcpAuthorization(
      authorizationRequest,
      session?.session ?? null
    ),
  };
};

export const getMcpConsentForRequest = async (
  request: Request,
  authorizationRequest: string
) => ({
  consent: await getMcpConsentRequest(authorizationRequest),
  user: await getSessionUserForRequest(request),
});
