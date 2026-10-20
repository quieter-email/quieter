export const DESKTOP_APP_ORIGIN = "quieter-app://app";

export type DesktopBridge = Readonly<{
  apiBaseURL: string;
  platform: string;
  openExternal: (url: string) => Promise<void>;
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
