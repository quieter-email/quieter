import { z } from "zod";

export const GOOGLE_CALENDAR_CONNECTOR_PROVIDER = "google_calendar" as const;
export const LINEAR_CONNECTOR_PROVIDER = "linear" as const;

export const CONNECTOR_PROVIDERS = [
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  LINEAR_CONNECTOR_PROVIDER,
] as const;

export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);

export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;

export const getConnectorDisplayName = (provider: ConnectorProvider) =>
  ({
    [GOOGLE_CALENDAR_CONNECTOR_PROVIDER]: "Google Calendar",
    [LINEAR_CONNECTOR_PROVIDER]: "Linear",
  })[provider];
