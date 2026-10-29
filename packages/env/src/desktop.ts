import { createEnv } from "@t3-oss/env-core";

import {
  httpUrl,
  throwEnvironmentValidationError,
  webSocketUrl,
} from "./schema";

const serverOrigin = httpUrl.refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/" &&
    (url.protocol === "https:" ||
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  );
}, "Desktop server must be an HTTPS origin or a loopback development origin.");

export const createDesktopEnv = (runtimeEnv: object) => {
  const read = (name: string) => {
    const value: unknown = Reflect.get(runtimeEnv, name);
    return typeof value === "string" ? value : undefined;
  };

  return createEnv({
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      DESKTOP_MAIL_UPDATES_URL: read("DESKTOP_MAIL_UPDATES_URL"),
      DESKTOP_SERVER_URL: read("DESKTOP_SERVER_URL"),
      ELECTRON_RENDERER_URL: read("ELECTRON_RENDERER_URL"),
    },
    server: {
      DESKTOP_MAIL_UPDATES_URL: webSocketUrl
        .refine((value) => {
          const url = new URL(value);
          return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            (url.protocol === "wss:" ||
              ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
          );
        }, "Live updates must use WSS or a loopback development connection.")
        .default("wss://updates.quieter.email/mail/live"),
      DESKTOP_SERVER_URL: serverOrigin.default("https://app.quieter.email"),
      ELECTRON_RENDERER_URL: serverOrigin
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
          );
        }, "Desktop development renderer must use a loopback HTTP origin.")
        .optional(),
    },
  });
};
