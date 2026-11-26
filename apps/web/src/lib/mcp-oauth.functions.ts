import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const authorizationRequestSchema = z.object({
  request: z.string().min(1).max(8192),
});

export const getMcpLogin = createServerFn({ method: "GET" })
  .validator(authorizationRequestSchema)
  .handler(async ({ data }) => {
    const { getMcpLoginForRequest } = await import("./mcp-oauth.server");
    return await getMcpLoginForRequest(getRequest(), data.request);
  });

export const getMcpConsent = createServerFn({ method: "GET" })
  .validator(authorizationRequestSchema)
  .handler(async ({ data }) => {
    const { getMcpConsentForRequest } = await import("./mcp-oauth.server");
    return await getMcpConsentForRequest(getRequest(), data.request);
  });
