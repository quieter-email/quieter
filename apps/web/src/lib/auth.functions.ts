import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getGoogleScopeRepairTargetForRequest, getSessionUserForRequest } from "./auth.server";

export const getSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  return await getSessionUserForRequest(getRequest());
});

export const getGoogleScopeRepairTarget = createServerFn({ method: "GET" })
  .inputValidator(
    (
      data:
        | {
            preferredMailboxId?: string | null;
            targetAccountId?: string | null;
          }
        | undefined,
    ) => ({
      preferredMailboxId: data?.preferredMailboxId?.trim() || null,
      targetAccountId: data?.targetAccountId?.trim() || null,
    }),
  )
  .handler(async ({ data }) => {
    return await getGoogleScopeRepairTargetForRequest(getRequest(), data);
  });
