import { z } from "zod";

export const signOutCleanupCommand = z.object({
  phase: z.enum(["capture", "cleanup", "release"]),
  requestId: z.uuid(),
});

export const signOutCleanupAcknowledgement = z.object({
  phase: z.enum(["capture", "cleanup"]),
  requestId: z.uuid(),
  success: z.boolean(),
});

export type SignOutCleanupCommand = z.infer<typeof signOutCleanupCommand>;

export const DESKTOP_APP_ORIGIN = "quieter-app://app";
export const DESKTOP_TITLE_BAR_HEIGHT = 40;

export type DesktopBridge = Readonly<{
  apiBaseURL: string;
  onSignOutCleanup: (
    listener: (command: SignOutCleanupCommand) => Promise<void>
  ) => () => void;
  platform: string;
  openExternal: (url: string) => Promise<void>;
  setTitleBarColors: (colors: {
    background: string;
    foreground: string;
  }) => Promise<void>;
}>;

export type DesktopAuthUser = Readonly<{
  id: string;
  email: string;
  name: string;
  image?: string | null;
}>;

export type DesktopAuthError = Readonly<{
  message: string;
  code?: string;
}>;
