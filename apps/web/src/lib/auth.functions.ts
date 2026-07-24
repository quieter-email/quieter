import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUserForRequest } = await import("./auth.server");
  return await getSessionUserForRequest(getRequest());
});
