import { setupRenderer } from "@better-auth/electron/preload";
import { contextBridge, ipcRenderer } from "electron";

import { DESKTOP_APP_ORIGIN, signOutCleanupCommand } from "../shared/bridge";
import type { DesktopBridge } from "../shared/bridge";

setupRenderer();

contextBridge.exposeInMainWorld("quieterDesktop", {
  apiBaseURL: DESKTOP_APP_ORIGIN,
  onSignOutCleanup: (listener) => {
    const receive = async (
      _event: Electron.IpcRendererEvent,
      input: unknown
    ) => {
      const command = signOutCleanupCommand.parse(input);
      let success = true;
      try {
        await listener(command);
      } catch {
        success = false;
      }
      if (command.phase !== "release") {
        await ipcRenderer.invoke("quieter:sign-out-cleanup-ack", {
          phase: command.phase,
          requestId: command.requestId,
          success,
        });
      }
    };
    const receiveCommand = (
      event: Electron.IpcRendererEvent,
      input: unknown
    ) => {
      void (async () => {
        try {
          await receive(event, input);
        } catch {
          // Navigation can invalidate a pending IPC acknowledgement.
        }
      })();
    };
    ipcRenderer.on("quieter:sign-out-cleanup", receiveCommand);
    return () => {
      ipcRenderer.removeListener("quieter:sign-out-cleanup", receiveCommand);
    };
  },
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
