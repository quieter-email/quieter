import { setupRenderer } from "@better-auth/electron/preload";
import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_APP_ORIGIN,
  reminderNotificationEvent,
  reminderNotificationResult,
  reminderNotificationStatus,
  signOutCleanupCommand,
} from "../shared/bridge";
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
  reminderNotifications: {
    getStatus: async () =>
      reminderNotificationStatus.parse(
        await ipcRenderer.invoke("quieter:reminder-notification-status")
      ),
    onOpen: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, input: unknown) => {
        const parsed = reminderNotificationEvent.safeParse(input);
        if (parsed.success) {
          listener(parsed.data);
        }
      };
      ipcRenderer.on("quieter:reminder-notification-open", receive);
      return () => {
        ipcRenderer.removeListener(
          "quieter:reminder-notification-open",
          receive
        );
      };
    },
    setEnabled: async (enabled) =>
      reminderNotificationStatus.parse(
        await ipcRenderer.invoke(
          "quieter:reminder-notification-enabled",
          enabled
        )
      ),
    show: async (event) =>
      reminderNotificationResult.parse(
        await ipcRenderer.invoke("quieter:reminder-notification-show", event)
      ),
  },
  setReminderNotificationUser: async (userId) => {
    await ipcRenderer.invoke("quieter:reminder-notification-user", userId);
  },
  setTitleBarColors: async (colors: {
    background: string;
    foreground: string;
  }): Promise<void> => {
    await ipcRenderer.invoke("quieter:set-title-bar-colors", colors);
  },
} satisfies DesktopBridge);
