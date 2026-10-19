import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { organizationHasBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import { apikey } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { assertUserCanManageOrganizationSettings } from "../mail-domain/service";
import { protectedProcedure } from "./base";

const permissionsSchema = z.object({
  audiences: z.array(z.enum(["read", "write"])).optional(),
  campaigns: z.array(z.enum(["read", "write", "send"])).optional(),
});
const organizationSchema = z.object({ organizationId: z.string().min(1) });

export const organizationApiKeysRouter = {
  create: protectedProcedure
    .input(
      organizationSchema.extend({
        expiresIn: z
          .number()
          .int()
          .min(86_400)
          .max(365 * 86_400)
          .nullable(),
        name: z.string().trim().min(1).max(64),
        permissions: permissionsSchema,
      })
    )
    .output(z.object({ key: z.string() }))
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      if (
        !(await organizationHasBillingFeature({
          feature: "organizationApiKeys",
          organizationId: input.organizationId,
        }))
      ) {
        throw new ORPCError("FORBIDDEN", {
          message: "API keys are not available on this team's plan.",
        });
      }
      const result = await auth.api.createApiKey({
        body: {
          configId: ORGANIZATION_API_KEY_CONFIG_ID,
          expiresIn: input.expiresIn,
          name: input.name,
          organizationId: input.organizationId,
          permissions: input.permissions,
          prefix: "quieter_",
          userId: context.userId,
        },
      });
      return { key: result.key };
    }),
  rotate: protectedProcedure
    .input(organizationSchema.extend({ keyId: z.string().min(1) }))
    .output(z.object({ cleanupFailed: z.boolean(), key: z.string() }))
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      if (
        !(await organizationHasBillingFeature({
          feature: "organizationApiKeys",
          organizationId: input.organizationId,
        }))
      ) {
        throw new ORPCError("FORBIDDEN", {
          message: "API keys are not available on this team's plan.",
        });
      }
      const [current] = await db
        .select()
        .from(apikey)
        .where(
          and(
            eq(apikey.id, input.keyId),
            eq(apikey.referenceId, input.organizationId),
            eq(apikey.configId, ORGANIZATION_API_KEY_CONFIG_ID)
          )
        )
        .limit(1);
      if (current === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "API key not found." });
      }
      if (
        current.enabled !== true ||
        (current.expiresAt !== null &&
          current.expiresAt.getTime() <= Date.now())
      ) {
        throw new ORPCError("CONFLICT", {
          message: "Only an active API key can be replaced.",
        });
      }
      const permissions =
        current.permissions === null
          ? {}
          : z
              .record(z.string(), z.array(z.string()))
              .parse(JSON.parse(current.permissions));
      const result = await auth.api.createApiKey({
        body: {
          configId: ORGANIZATION_API_KEY_CONFIG_ID,
          expiresIn:
            current.expiresAt === null
              ? null
              : Math.max(
                  1,
                  Math.floor((current.expiresAt.getTime() - Date.now()) / 1000)
                ),
          name: current.name?.trim() || "API key",
          organizationId: input.organizationId,
          permissions,
          prefix: current.prefix?.trim() || "quieter_",
          userId: context.userId,
        },
      });
      let cleanupFailed = false;
      try {
        await db
          .delete(apikey)
          .where(
            and(
              eq(apikey.id, current.id),
              eq(apikey.referenceId, input.organizationId),
              eq(apikey.configId, ORGANIZATION_API_KEY_CONFIG_ID)
            )
          );
      } catch (error) {
        reportError(error, {
          operation: "organization-api-key:rotation-cleanup",
        });
        cleanupFailed = true;
      }
      return { cleanupFailed, key: result.key };
    }),
};
