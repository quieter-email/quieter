import { z } from "zod";

export const GOOGLE_CALENDAR_CONNECTOR_PROVIDER = "google_calendar" as const;
export const LINEAR_CONNECTOR_PROVIDER = "linear" as const;

export const CONNECTOR_PROVIDERS = [
  LINEAR_CONNECTOR_PROVIDER,
  "notion",
  "todoist",
  "clickup",
  "microsoft_calendar",
  "microsoft_onedrive",
] as const;

export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);

export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;

export const connectorDisplayNames: Record<ConnectorProvider, string> = {
  clickup: "ClickUp",
  linear: "Linear",
  microsoft_calendar: "Outlook Calendar",
  microsoft_onedrive: "OneDrive",
  notion: "Notion",
  todoist: "Todoist",
};
