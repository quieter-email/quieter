import type { ConnectorProvider } from "@quieter/app/lib/connectors-query";

const connectorIcons = {
  clickup: { className: "", src: "/clickup.svg" },
  linear: { className: "invert dark:invert-0", src: "/linear.svg" },
  microsoft_calendar: { className: "", src: "/microsoft-outlook.svg" },
  microsoft_onedrive: { className: "", src: "/microsoft-onedrive.svg" },
  notion: { className: "dark:invert", src: "/notion.svg" },
  todoist: { className: "", src: "/todoist.svg" },
} as const satisfies Record<
  ConnectorProvider,
  { className: string; src: string }
>;

export const getConnectorIcon = (provider: ConnectorProvider) =>
  connectorIcons[provider];
