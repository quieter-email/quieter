import type {
  NewMailNotificationContext,
  NewMailNotificationPreferences,
  NewMailNotificationResult,
  NewMailNotifications,
  ReminderNotifications,
} from "@quieter/app/runtime";
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

const newMailNotificationScope = z.strictObject({
  mailboxId: z.string().min(1).max(500),
  userId: z.string().min(1).max(500),
});

export const newMailNotificationPreferenceRequest = z.discriminatedUnion(
  "kind",
  [
    newMailNotificationScope.extend({ kind: z.literal("get-status") }),
    newMailNotificationScope.extend({
      enabled: z.boolean(),
      kind: z.literal("set-enabled"),
    }),
  ]
);

export const newMailNotificationPreferenceStatus = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      enabled: z.boolean(),
      kind: z.literal("ready"),
      supported: z.boolean(),
    }),
    z.strictObject({ kind: z.literal("inactive") }),
  ]
);

export const newMailNotificationCapture = newMailNotificationScope;

export const newMailNotificationDelivery = z.strictObject({
  contextId: z.uuid(),
  mailboxId: z.string().min(1).max(500),
  messageId: z.string().min(1).max(500),
  receivedAt: z.iso.datetime({ precision: 3 }).refine((value) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  }),
  threadId: z.string().min(1).max(500),
});

export const newMailNotificationContext = z.discriminatedUnion("kind", [
  z.strictObject({ contextId: z.uuid(), kind: z.literal("enabled") }),
  z.strictObject({
    kind: z.enum(["inactive", "disabled", "unsupported", "blocked"]),
  }),
]) satisfies z.ZodType<NewMailNotificationContext>;

export const newMailNotificationResult = z.enum([
  "shown",
  "duplicate",
  "quiet",
  "inactive",
  "stale",
  "blocked",
]) satisfies z.ZodType<NewMailNotificationResult>;

export type NewMailNotificationPreferenceRequest = z.infer<
  typeof newMailNotificationPreferenceRequest
>;

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
  newMailNotificationPreferences: NewMailNotificationPreferences;
  newMailNotifications?: NewMailNotifications;
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
