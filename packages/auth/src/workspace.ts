export const PERSONAL_WORKSPACE_ID = "personal";

export type WorkspaceId = string;

export const isPersonalWorkspaceId = (workspaceId: WorkspaceId) =>
  workspaceId === PERSONAL_WORKSPACE_ID;

export const toOrganizationId = (workspaceId: WorkspaceId): string | null =>
  isPersonalWorkspaceId(workspaceId) ? null : workspaceId;

export const toWorkspaceId = (activeOrganizationId: string | null | undefined): WorkspaceId =>
  activeOrganizationId ?? PERSONAL_WORKSPACE_ID;
