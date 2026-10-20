import { z } from "zod";

export const DESKTOP_AUTH_CLIENT_ID = "quieter-desktop";
export const DESKTOP_AUTH_PROTOCOL_SCHEME = "com.quieter.desktop";
export const DESKTOP_AUTH_BROWSER_PATH = "/desktop/auth";
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth/callback";

export const desktopAuthQuerySchema = z.object({
  client_id: z.literal(DESKTOP_AUTH_CLIENT_ID),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  state: z.string().regex(/^[A-Za-z0-9]{16}$/u),
});

export type DesktopAuthQuery = z.infer<typeof desktopAuthQuerySchema>;
