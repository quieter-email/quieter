export type NewMailNotificationScope = Readonly<{
  userId: string;
  mailboxId: string;
}>;

export type NewMailNotificationPreferenceStatus =
  | Readonly<{ kind: "ready"; enabled: boolean; supported: boolean }>
  | Readonly<{ kind: "inactive" }>;

export type NewMailNotificationPreferences = Readonly<{
  getStatus: (
    scope: NewMailNotificationScope
  ) => Promise<NewMailNotificationPreferenceStatus>;
  setEnabled: (
    input: NewMailNotificationScope & { enabled: boolean }
  ) => Promise<NewMailNotificationPreferenceStatus>;
}>;

export type NewMailNotificationContext =
  | Readonly<{ kind: "enabled"; contextId: string }>
  | Readonly<{ kind: "inactive" | "disabled" | "unsupported" | "blocked" }>;

export type NewMailNotificationDelivery = Readonly<{
  contextId: string;
  mailboxId: string;
  messageId: string;
  receivedAt: string;
  threadId: string;
}>;

export type NewMailNotificationResult =
  | "shown"
  | "duplicate"
  | "quiet"
  | "inactive"
  | "stale"
  | "blocked";

export type NewMailNotifications = Readonly<{
  capture: (
    scope: NewMailNotificationScope
  ) => Promise<NewMailNotificationContext>;
  show: (
    input: NewMailNotificationDelivery
  ) => Promise<NewMailNotificationResult>;
}>;

export type ReminderNotificationEvent = Readonly<{
  id: string;
  mailboxId: string;
  reminderId: string;
  scheduleVersion: number;
  threadId?: string;
}>;

export type ReminderNotificationStatus =
  | "enabled"
  | "disabled"
  | "unsupported"
  | "blocked";

export type ReminderNotifications = Readonly<{
  getStatus: () => Promise<ReminderNotificationStatus>;
  setEnabled: (enabled: boolean) => Promise<ReminderNotificationStatus>;
  show: (
    event: ReminderNotificationEvent
  ) => Promise<
    | "shown"
    | "duplicate"
    | "inactive"
    | Exclude<ReminderNotificationStatus, "enabled">
  >;
  onOpen: (listener: (event: ReminderNotificationEvent) => void) => () => void;
}>;

type AppRuntime = {
  apiBaseURL?: string;
  fetch?: typeof globalThis.fetch;
  openExternal?: (url: string) => void | Promise<void>;
  platform?: "desktop" | "web";
  reminderNotifications?: ReminderNotifications;
  newMailNotificationPreferences?: NewMailNotificationPreferences;
  newMailNotifications?: NewMailNotifications;
};

export const appRuntime: AppRuntime = {};

export const configureAppRuntime = (options: AppRuntime) => {
  Object.assign(appRuntime, {
    apiBaseURL: options.apiBaseURL,
    fetch: options.fetch,
    newMailNotificationPreferences: options.newMailNotificationPreferences,
    newMailNotifications: options.newMailNotifications,
    openExternal: options.openExternal,
    platform: options.platform,
    reminderNotifications: options.reminderNotifications,
  });
};

export const getApiUrl = (pathname: string) =>
  appRuntime.apiBaseURL
    ? new URL(pathname, appRuntime.apiBaseURL).toString()
    : pathname;

export const appFetch: typeof globalThis.fetch = async (input, init) =>
  await (appRuntime.fetch ?? globalThis.fetch)(input, init);

export const openExternalUrl = async (url: string) => {
  if (appRuntime.openExternal) {
    await appRuntime.openExternal(url);
    return;
  }

  window.location.assign(url);
};
