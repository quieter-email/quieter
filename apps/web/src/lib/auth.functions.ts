import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getGoogleScopeRepairTargetForRequest, getSessionUserForRequest } from "./auth.server";

const normalizeOptionalString = (value: string | null | undefined) => {
  const normalizedValue = value?.trim();
  return normalizedValue || null;
};

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
      preferredMailboxId: normalizeOptionalString(data?.preferredMailboxId),
      targetAccountId: normalizeOptionalString(data?.targetAccountId),
    }),
  )
  .handler(async ({ data }) => {
    return await getGoogleScopeRepairTargetForRequest(getRequest(), data);
  });
