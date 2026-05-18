import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { authClient } from "~/lib/auth";

export type OrganizationSummary = NonNullable<
  ReturnType<typeof authClient.useListOrganizations>["data"]
>[number];
export type OrganizationPermissionCheck = Parameters<
  typeof authClient.organization.checkRolePermission
>[0];
export type OrganizationPermissions = OrganizationPermissionCheck["permissions"];
export type UserInvitation = {
  createdAt: Date | string;
  email: string;
  expiresAt: Date | string;
  id: string;
  inviterId: string;
  organizationId: string;
  organizationName: string;
  role: string;
  status: string;
  teamId?: string | null;
};

export const organizationRoleOptions = ["owner", "admin", "member"] as const;
export const getUserInvitationsQueryKey = (userId: string) =>
  ["auth", userId, "organization", "list-user-invitations"] as const;
export const getFullOrganizationQueryKey = (organizationId: string) =>
  ["auth", "organization", organizationId, "full"] as const;

export type OrganizationRoleOption = (typeof organizationRoleOptions)[number];

const organizationMemberSchema = z.object({
  id: z.string(),
  role: z.string(),
  user: z.object({
    email: z.string(),
    name: z.string(),
  }),
  userId: z.string(),
});
const organizationInvitationSchema = z.object({
  email: z.string(),
  id: z.string(),
  role: z.string(),
  status: z.string(),
});
const fullOrganizationSchema = z.object({
  createdAt: z.coerce.date(),
  id: z.string(),
  invitations: z.array(organizationInvitationSchema),
  logo: z.string().nullable().optional(),
  members: z.array(organizationMemberSchema),
  metadata: z.unknown().optional(),
  name: z.string(),
  slug: z.string(),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export type FullOrganization = z.infer<typeof fullOrganizationSchema>;

export const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? `1 ${singular}` : `${count} ${plural}`;

const splitOrganizationRoles = (value: string) =>
  value.split(",").flatMap((part) => {
    const role = part.trim().toLowerCase();
    return role ? [role] : [];
  });

export const formatRoleLabel = (value: string) =>
  splitOrganizationRoles(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(", ");

export const hasOrganizationRole = (value: string, role: OrganizationRoleOption) =>
  splitOrganizationRoles(value).includes(role);

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export const normalizeOrganizationRole = (value: string): OrganizationRoleOption => {
  const primaryRole = splitOrganizationRoles(value).find((part): part is OrganizationRoleOption =>
    organizationRoleOptions.includes(part as OrganizationRoleOption),
  );

  return primaryRole ?? "member";
};

export const slugifyOrganizationName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const formatDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return dateFormatter.format(date);
};

export const hasOrganizationPermission = (
  role: OrganizationPermissionCheck["role"] | null,
  permissions: OrganizationPermissions,
) => (role ? authClient.organization.checkRolePermission({ permissions, role }) : false);

const invitationStatuses = new Set(["pending", "accepted", "rejected", "canceled"]);

const isInvitationDate = (value: unknown): value is Date | string =>
  value instanceof Date
    ? !Number.isNaN(value.getTime())
    : typeof value === "string" && !Number.isNaN(new Date(value).getTime());

const isUserInvitation = (value: unknown): value is UserInvitation => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const invitation = value as Record<string, unknown>;
  return (
    typeof invitation.id === "string" &&
    typeof invitation.email === "string" &&
    typeof invitation.inviterId === "string" &&
    typeof invitation.organizationId === "string" &&
    typeof invitation.organizationName === "string" &&
    typeof invitation.role === "string" &&
    typeof invitation.status === "string" &&
    invitationStatuses.has(invitation.status) &&
    isInvitationDate(invitation.createdAt) &&
    isInvitationDate(invitation.expiresAt) &&
    (invitation.teamId === undefined ||
      invitation.teamId === null ||
      typeof invitation.teamId === "string")
  );
};

const normalizeUserInvitations = (value: unknown): UserInvitation[] => {
  if (Array.isArray(value)) {
    return value.filter(isUserInvitation);
  }

  if (typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)) {
    return value.data.filter(isUserInvitation);
  }

  return [];
};

const loadUserInvitations = async (): Promise<UserInvitation[]> => {
  const response = await authClient.organization.listUserInvitations();
  if (response.error) {
    throw new Error(response.error.message ?? "Could not load invitations.");
  }

  return normalizeUserInvitations(response);
};

export const userInvitationsQueryOptions = (userId: string, enabled = true) =>
  queryOptions({
    enabled,
    queryFn: loadUserInvitations,
    queryKey: getUserInvitationsQueryKey(userId),
  });

const loadFullOrganization = async (organizationId: string): Promise<FullOrganization | null> => {
  const result = await authClient.organization.getFullOrganization({
    query: {
      membersLimit: 500,
      organizationId,
    },
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Could not load team.");
  }

  return result.data ? fullOrganizationSchema.parse(result.data) : null;
};

export const fullOrganizationQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: () => loadFullOrganization(organizationId),
    queryKey: getFullOrganizationQueryKey(organizationId),
  });
