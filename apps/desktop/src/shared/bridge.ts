import type { ReminderNotifications } from "@quieter/app/runtime";
import { z } from "zod";

export const reminderNotificationEvent = z.strictObject({
  id: z.uuid(),
  mailboxId: z.string().min(1).max(500),
  reminderId: z.uuid(),
  scheduleVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  threadId: z.string().min(1).max(500).optional(),
});

export const reminderNotificationUser = z.string().min(1).max(500).nullable();
export const reminderNotificationsEnabled = z.boolean();
export const reminderNotificationStatus = z.enum([
  "enabled",
  "disabled",
  "unsupported",
  "blocked",
]);
export const reminderNotificationResult = z.enum([
  "shown",
  "duplicate",
  "inactive",
  "disabled",
  "unsupported",
  "blocked",
]);

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
  reminderNotifications: ReminderNotifications;
  setReminderNotificationUser: (userId: string | null) => Promise<void>;
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
