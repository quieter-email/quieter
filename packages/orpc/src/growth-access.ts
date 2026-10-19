import { ORPCError } from "@orpc/server";

import {
  assertUserCanManageOrganizationSettings,
  assertUserOrganizationMember,
} from "./mail-domain/service";

export type GrowthScope =
  | "audiences:read"
  | "audiences:write"
  | "campaigns:read"
  | "campaigns:write"
  | "campaigns:send";

export type GrowthActor =
  | { organizationId: string; userId: string; apiKeyId?: never; scopes?: never }
  | {
      organizationId: string;
      apiKeyId: string;
      scopes: GrowthScope[];
      userId?: never;
    };

export const assertGrowthAccess = async (
  actor: GrowthActor,
  scope: GrowthScope
): Promise<void> => {
  if (actor.userId !== undefined) {
    const input = {
      organizationId: actor.organizationId,
      userId: actor.userId,
    };
    if (scope.endsWith(":read")) {
      await assertUserOrganizationMember(input);
    } else {
      await assertUserCanManageOrganizationSettings(input);
    }
    return;
  }
  if (!actor.scopes.includes(scope)) {
    throw new ORPCError("FORBIDDEN", {
      message: "This key does not have permission for this action.",
    });
  }
};
