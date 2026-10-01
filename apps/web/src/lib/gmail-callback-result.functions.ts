import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { z } from "zod";

export const getGmailCallbackError = createServerFn({ method: "GET" }).handler(
  () => {
    setResponseHeader("Cache-Control", "no-store");
    const value = getCookie("gmail-callback-error");
    deleteCookie("gmail-callback-error", { path: "/" });
    if (!value) {
      return null;
    }
    try {
      const parsed = z
        .object({
          message: z.string().min(1).max(1024),
          status: z.union([
            z.literal(400),
            z.literal(401),
            z.literal(403),
            z.literal(409),
          ]),
        })
        .safeParse(JSON.parse(value));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
);
