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
  keepMailUpdatesInBackground?: boolean;
  reminderNotifications?: ReminderNotifications;
};

export const appRuntime: AppRuntime = {};

export const configureAppRuntime = (options: AppRuntime) => {
  Object.assign(appRuntime, {
    apiBaseURL: options.apiBaseURL,
    fetch: options.fetch,
    keepMailUpdatesInBackground: options.keepMailUpdatesInBackground,
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
