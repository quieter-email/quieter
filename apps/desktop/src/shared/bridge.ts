export const DESKTOP_APP_ORIGIN = "quieter-app://app";
export const DESKTOP_TITLE_BAR_HEIGHT = 40;

export type DesktopBridge = Readonly<{
  apiBaseURL: string;
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
