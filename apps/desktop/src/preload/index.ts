import { setupRenderer } from "@better-auth/electron/preload";
import { contextBridge, ipcRenderer } from "electron";

import { DESKTOP_APP_ORIGIN } from "../shared/bridge";
import type { DesktopBridge } from "../shared/bridge";

setupRenderer();

contextBridge.exposeInMainWorld("quieterDesktop", {
  apiBaseURL: DESKTOP_APP_ORIGIN,
  openExternal: async (url: string): Promise<void> => {
    await ipcRenderer.invoke("quieter:open-external", url);
  },
  platform: process.platform,
  setTitleBarColors: async (colors: {
    background: string;
    foreground: string;
  }): Promise<void> => {
    await ipcRenderer.invoke("quieter:set-title-bar-colors", colors);
  },
} satisfies DesktopBridge);
