import type { ConnectorProvider } from "./connectors-query";

/**
 * Artwork is the one thing that cannot be derived from a connector's record,
 * so it lives here and nowhere else. Everything else about a connector comes
 * from the connector list itself.
 */
export const connectorIcons = {
  google_calendar: { className: "", src: "/google-calendar.svg" },
  linear: { className: "invert dark:invert-0", src: "/linear.svg" },
} as const satisfies Record<
  ConnectorProvider,
  { className: string; src: string }
>;

export const getConnectorIcon = (provider: ConnectorProvider) =>
  connectorIcons[provider];
