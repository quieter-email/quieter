import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { auth } from "./index";
import { disconnectMcpClient, listMcpConnections } from "./mcp";
import type { McpAccount } from "./mcp";
import { loadMcpAccountUser, runMcpAccountAuth } from "./mcp-account-principal";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "./organization-api-key";

type AccountActionPolicy = "read" | "write" | "delete" | "bulk-delete";

const accountAction = <Schema extends z.ZodObject, Result>(
  schema: Schema,
  description: string,
  policy: AccountActionPolicy,
  run: (principal: McpAccount, input: z.output<Schema>) => Result
) => ({
  description,
  handler: async (principal: McpAccount, rawInput: unknown) =>
    await run(principal, schema.parse(rawInput)),
  policy,
  schema,
});

const emptyInput = z.strictObject({});
const organizationId = z.string().trim().min(1).describe("The team ID");
const teamInput = z.strictObject({ organizationId });
const invitationInput = z.strictObject({
  invitationId: z.string().trim().min(1),
});
const teamName = z.string().trim().min(1);
const teamSlug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const memberId = z
  .string()
  .trim()
  .regex(/^[^@]+$/u)
  .describe("The team membership ID");
const keyId = z.string().trim().min(1).describe("The API key ID");
const teamMemberInput = teamInput.extend({ memberId });
const teamKeyInput = teamInput.extend({ keyId });

const requireOtherMember = async (
  principal: McpAccount,
  input: z.output<typeof teamMemberInput>
) => {
  const { members } = await runMcpAccountAuth(
    principal,
    auth.api.listMembers,
    async (headers) =>
      await auth.api.listMembers({
        headers,
        query: {
          filterField: "userId",
          filterOperator: "eq",
          filterValue: principal.id,
          limit: 1,
          organizationId: input.organizationId,
        },
      })
  );
  if (members[0]?.id === input.memberId) {
    throw new APIError("BAD_REQUEST", {
      message: "You can only manage other members. To leave, use team.leave.",
    });
  }
};

const getTeamKey = async (
  principal: McpAccount,
  input: z.output<typeof teamKeyInput>
) => {
  const key = await runMcpAccountAuth(
    principal,
    auth.api.getApiKey,
    async (headers) =>
      await auth.api.getApiKey({
        headers,
        query: { configId: ORGANIZATION_API_KEY_CONFIG_ID, id: input.keyId },
      })
  );
  if (key.referenceId !== input.organizationId) {
    throw new APIError("NOT_FOUND", {
      message: "API key not found in this team.",
    });
  }
  return key;
};

const revokeKey = async (principal: McpAccount, id: string) =>
  await runMcpAccountAuth(
    principal,
    auth.api.deleteApiKey,
    async (headers) =>
      await auth.api.deleteApiKey({
        body: { configId: ORGANIZATION_API_KEY_CONFIG_ID, keyId: id },
        headers,
      })
  );

const settingsLink = (query: Record<string, string>) => {
  const url = new URL(
    "/settings",
    serverEnv.BETTER_AUTH_URL ?? "http://localhost:3000"
  );
  url.search = new URLSearchParams(query).toString();
  return { url: url.href };
};

export const mcpAccountActions = {
  account_disconnect_client: accountAction(
    z.strictObject({ clientId: z.string().min(1) }),
    "Disconnect an app authorized to act as this account.",
    "delete",
    async (principal, { clientId }) => {
      await disconnectMcpClient({ clientId, userId: principal.id });
      return { disconnected: true };
    }
  ),
  account_get_profile: accountAction(
    emptyInput,
    "Read the signed-in account's profile and email verification status.",
    "read",
    async (principal) =>
      await withRequestDatabaseClient(async () => {
        const { internalAdapter } = await auth.$context;
        const { id, name, email, emailVerified, image } =
          await loadMcpAccountUser(internalAdapter, principal.id);
        return { email, emailVerified, id, image: image ?? null, name };
      })
  ),
  account_list_connected_clients: accountAction(
    emptyInput,
    "List apps authorized to act as this account.",
    "read",
    async (principal) => await listMcpConnections(principal.id)
  ),
  account_settings_link: accountAction(
    emptyInput,
    "Get the browser link to change your sign-in email, manage passkeys, or delete your account.",
    "read",
    () => settingsLink({ tab: "account" })
  ),
  account_update_profile: accountAction(
    z.strictObject({ name: z.string().trim().min(1) }),
    "Change the signed-in account's display name.",
    "write",
    async (principal, body) =>
      await runMcpAccountAuth(
        principal,
        auth.api.updateUser,
        async (headers) => await auth.api.updateUser({ body, headers })
      )
  ),
  team_accept_invitation: accountAction(
    invitationInput,
    "Accept an invitation to join a team.",
    "write",
    async (principal, body) =>
      await runMcpAccountAuth(
        principal,
        auth.api.acceptInvitation,
        async (headers) => await auth.api.acceptInvitation({ body, headers })
      )
  ),
  team_api_key_settings_link: accountAction(
    teamInput,
    "Get the browser link to create or rotate API keys and collect the new secret.",
    "read",
    (_principal, input) =>
      settingsLink({
        ...input,
        organizationView: "api-keys",
        tab: "organization",
      })
  ),
  team_cancel_invitation: accountAction(
    teamInput.extend(invitationInput.shape),
    "Cancel a pending invitation your team sent.",
    "delete",
    async (principal, { invitationId, organizationId: id }) => {
      const invitations = await runMcpAccountAuth(
        principal,
        auth.api.listInvitations,
        async (headers) =>
          await auth.api.listInvitations({
            headers,
            query: { organizationId: id },
          })
      );
      if (
        !invitations.some(
          (invitation) =>
            invitation.id === invitationId && invitation.status === "pending"
        )
      ) {
        throw new APIError("NOT_FOUND", {
          message: "Pending invitation not found in this team.",
        });
      }
      return await runMcpAccountAuth(
        principal,
        auth.api.cancelInvitation,
        async (headers) =>
          await auth.api.cancelInvitation({ body: { invitationId }, headers })
      );
    }
  ),
  team_create: accountAction(
    z.strictObject({ name: teamName, slug: teamSlug }),
    "Create a team with a name and a unique lowercase slug.",
    "write",
    async (principal, input) =>
      await runMcpAccountAuth(
        principal,
        auth.api.createOrganization,
        async (headers) =>
          await auth.api.createOrganization({
            body: { ...input, keepCurrentActiveOrganization: true },
            headers,
          })
      )
  ),
  team_delete: accountAction(
    teamInput,
    "Delete a team and its managed mailboxes and other team resources.",
    "bulk-delete",
    async (principal, body) =>
      await runMcpAccountAuth(
        principal,
        auth.api.deleteOrganization,
        async (headers) => await auth.api.deleteOrganization({ body, headers })
      )
  ),
  team_get: accountAction(
    teamInput,
    "Get a team's details, members, and invitations visible to you.",
    "read",
    async (principal, query) =>
      await runMcpAccountAuth(
        principal,
        auth.api.getFullOrganization,
        async (headers) =>
          await auth.api.getFullOrganization({ headers, query })
      )
  ),
  team_invite_member: accountAction(
    teamInput.extend({ email: z.string().trim().pipe(z.email()) }),
    "Invite someone to join a team as a member using their email address.",
    "write",
    async (principal, input) =>
      await runMcpAccountAuth(
        principal,
        auth.api.createInvitation,
        async (headers) =>
          await auth.api.createInvitation({
            body: { ...input, role: "member" },
            headers,
          })
      )
  ),
  team_leave: accountAction(
    teamInput,
    "Leave a team and lose access to its shared resources.",
    "delete",
    async (principal, body) =>
      await runMcpAccountAuth(
        principal,
        auth.api.leaveOrganization,
        async (headers) => await auth.api.leaveOrganization({ body, headers })
      )
  ),
  team_list: accountAction(
    emptyInput,
    "List teams you belong to and their IDs.",
    "read",
    async (principal) =>
      await runMcpAccountAuth(
        principal,
        auth.api.listOrganizations,
        async (headers) => await auth.api.listOrganizations({ headers })
      )
  ),
  team_list_api_keys: accountAction(
    teamInput.extend({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    "List a team's API keys and their identifying prefixes.",
    "read",
    async (principal, input) => {
      const result = await runMcpAccountAuth(
        principal,
        auth.api.listApiKeys,
        async (headers) =>
          await auth.api.listApiKeys({
            headers,
            query: {
              ...input,
              configId: ORGANIZATION_API_KEY_CONFIG_ID,
              limit: input.limit ?? 50,
              sortBy: "createdAt",
              sortDirection: "desc",
            },
          })
      );
      return {
        apiKeys: result.apiKeys.map(
          ({
            id,
            name,
            start,
            enabled,
            createdAt,
            expiresAt,
            lastRequest,
            prefix,
          }) => ({
            createdAt,
            enabled,
            expiresAt,
            id,
            lastRequest,
            name,
            prefix,
            start,
          })
        ),
        limit: result.limit,
        offset: result.offset,
        total: result.total,
      };
    }
  ),
  team_list_my_invitations: accountAction(
    emptyInput,
    "List pending team invitations sent to your account.",
    "read",
    async (principal) =>
      await runMcpAccountAuth(
        principal,
        auth.api.listUserInvitations,
        async (headers) => await auth.api.listUserInvitations({ headers })
      )
  ),
  team_reject_invitation: accountAction(
    invitationInput,
    "Decline a team invitation sent to your account.",
    "delete",
    async (principal, body) =>
      await runMcpAccountAuth(
        principal,
        auth.api.rejectInvitation,
        async (headers) => await auth.api.rejectInvitation({ body, headers })
      )
  ),
  team_remove_member: accountAction(
    teamMemberInput,
    "Remove a team member and revoke their access. Use the membership ID from team.get.",
    "delete",
    async (principal, input) => {
      await requireOtherMember(principal, input);
      return await runMcpAccountAuth(
        principal,
        auth.api.removeMember,
        async (headers) =>
          await auth.api.removeMember({
            body: {
              memberIdOrEmail: input.memberId,
              organizationId: input.organizationId,
            },
            headers,
          })
      );
    }
  ),
  team_revoke_api_key: accountAction(
    teamKeyInput,
    "Revoke one team API key by ID. Requests that use the key will stop working.",
    "delete",
    async (principal, input) => {
      await getTeamKey(principal, input);
      return await revokeKey(principal, input.keyId);
    }
  ),
  team_update: accountAction(
    teamInput
      .extend({ name: teamName.optional(), slug: teamSlug.optional() })
      .refine(({ name, slug }) => name !== undefined || slug !== undefined, {
        message: "Provide a name or slug to update.",
      }),
    "Change a team's name or slug.",
    "write",
    async (principal, { organizationId: id, ...data }) =>
      await runMcpAccountAuth(
        principal,
        auth.api.updateOrganization,
        async (headers) =>
          await auth.api.updateOrganization({
            body: { data, organizationId: id },
            headers,
          })
      )
  ),
  team_update_member_role: accountAction(
    teamMemberInput.extend({ role: z.enum(["member", "admin", "owner"]) }),
    "Change a team member's role. Use the membership ID from team.get.",
    "write",
    async (principal, body) => {
      await requireOtherMember(principal, body);
      return await runMcpAccountAuth(
        principal,
        auth.api.updateMemberRole,
        async (headers) => await auth.api.updateMemberRole({ body, headers })
      );
    }
  ),
};
