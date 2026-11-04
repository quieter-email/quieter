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

export const linearReadTools = new Set([
  "get_issue",
  "list_issues",
  "search_issues",
  "get_comment",
  "list_comments",
  "get_project",
  "list_projects",
  "get_document",
  "list_documents",
  "get_team",
  "list_teams",
  "get_user",
  "list_users",
  "get_viewer",
  "get_cycle",
  "list_cycles",
  "get_issue_status",
  "list_issue_statuses",
  "list_issue_labels",
  "get_issue_label",
  "list_project_labels",
  "get_project_label",
  "get_initiative",
  "list_initiatives",
  "get_initiative_update",
  "list_initiative_updates",
  "get_project_update",
  "list_project_updates",
  "search",
  "search_documentation",
]);
