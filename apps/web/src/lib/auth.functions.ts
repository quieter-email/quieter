import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSessionUserForRequest } from "./auth.server";

export const getSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  return await getSessionUserForRequest(getRequest());
});
