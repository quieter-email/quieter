import type { GetEmailIdentityCommandOutput } from "@aws-sdk/client-sesv2";
import type { MailDomainCheckResult } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { db, mailDomain } from "@quieter/database";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  aggregateMailDomainStatus,
  createMailDomainDnsRecords,
  createMailDomainOwnershipToken,
  getMailDomainOwnershipToken,
  MAIL_DOMAIN_STATUS_VERIFIED,
  normalizeMailDomain,
} from "../mail-domain/records";
import {
  assertUserCanManageMailDomains,
  assertUserOrganizationMember,
  checkMailDomainDnsRecords,
  createOrLoadEmailIdentity,
  createSesIdentityCheck,
  createSesMailFromCheck,
  defaultDnsLookup,
  deleteMailDomainAwsResources,
  ensureMailFromDomain,
  ensureReceiptRule,
  getAwsRegion,
  getDkimTokens,
  getEmailIdentity,
} from "../mail-domain/service";
import { protectedProcedure } from "./base";

export const mailDomainsRouter = {
  list: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserOrganizationMember({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      const domains = await db
        .select({
          createdAt: mailDomain.createdAt,
          domain: mailDomain.domain,
          id: mailDomain.id,
          lastCheckResult: mailDomain.lastCheckResult,
          mailFromDomain: mailDomain.mailFromDomain,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
          status: mailDomain.status,
          updatedAt: mailDomain.updatedAt,
          verifiedAt: mailDomain.verifiedAt,
        })
        .from(mailDomain)
        .where(eq(mailDomain.organizationId, input.organizationId))
        .orderBy(desc(mailDomain.createdAt));

      return { domains };
    }),

  createSetup: protectedProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      const entitlement = await getOrganizationBillingEntitlement({
        feature: "organizationDomains",
        organizationId: input.organizationId,
      });
      if (!entitlement.hasAccess) {
        throw new ORPCError("FORBIDDEN", {
          message: "Custom organization domains require Team billing.",
        });
      }

      const domain = normalizeMailDomain(input.domain);
      const [existingDomain] = await db
        .select({
          id: mailDomain.id,
          organizationId: mailDomain.organizationId,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
          status: mailDomain.status,
          verifiedAt: mailDomain.verifiedAt,
        })
        .from(mailDomain)
        .where(eq(mailDomain.domain, domain))
        .limit(1);

      if (existingDomain && existingDomain.organizationId !== input.organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This domain is already registered to another organization.",
        });
      }

      const region = getAwsRegion();
      const mailFromDomain = `bounce.${domain}`;
      const createdIdentity = await createOrLoadEmailIdentity(domain);

      await ensureMailFromDomain({ domain, mailFromDomain });

      const identity =
        (createdIdentity.DkimAttributes?.Tokens?.length ?? 0) === 0
          ? await getEmailIdentity(domain)
          : createdIdentity;
      const records = createMailDomainDnsRecords({
        dkimTokens: getDkimTokens(identity),
        domain,
        ownershipToken:
          getMailDomainOwnershipToken(existingDomain?.requiredDnsRecords ?? []) ??
          createMailDomainOwnershipToken(),
        region,
      });
      const now = new Date();

      if (existingDomain) {
        const hasOwnershipRecord = getMailDomainOwnershipToken(existingDomain.requiredDnsRecords);
        const status = hasOwnershipRecord ? existingDomain.status : "pending_dns";
        const [updatedDomain] = await db
          .update(mailDomain)
          .set({
            mailFromDomain,
            requiredDnsRecords: records,
            status,
            updatedAt: now,
            verifiedAt: hasOwnershipRecord ? existingDomain.verifiedAt : null,
          })
          .where(eq(mailDomain.id, existingDomain.id))
          .returning({
            id: mailDomain.id,
            status: mailDomain.status,
          });

        return {
          domain,
          domainId: updatedDomain?.id ?? existingDomain.id,
          records,
          status: updatedDomain?.status ?? status,
        };
      }

      const id = crypto.randomUUID();
      const [createdDomain] = await db
        .insert(mailDomain)
        .values({
          createdAt: now,
          domain,
          id,
          lastCheckResult: null,
          mailFromDomain,
          organizationId: input.organizationId,
          requiredDnsRecords: records,
          status: "pending_dns",
          updatedAt: now,
          verifiedAt: null,
        })
        .returning({
          id: mailDomain.id,
          status: mailDomain.status,
        });

      return {
        domain,
        domainId: createdDomain?.id ?? id,
        records,
        status: createdDomain?.status ?? "pending_dns",
      };
    }),

  checkSetup: protectedProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      const entitlement = await getOrganizationBillingEntitlement({
        feature: "organizationDomains",
        organizationId: input.organizationId,
      });
      if (!entitlement.hasAccess) {
        throw new ORPCError("FORBIDDEN", {
          message: "Custom organization domains require Team billing.",
        });
      }

      const domain = normalizeMailDomain(input.domain);
      const [storedDomain] = await db
        .select({
          id: mailDomain.id,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
          verifiedAt: mailDomain.verifiedAt,
        })
        .from(mailDomain)
        .where(
          and(eq(mailDomain.organizationId, input.organizationId), eq(mailDomain.domain, domain)),
        )
        .limit(1);

      if (!storedDomain) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mail domain setup was not found in the active organization.",
        });
      }

      let identity: GetEmailIdentityCommandOutput;

      try {
        identity = await getEmailIdentity(domain);
      } catch {
        identity = { $metadata: {} };
      }

      const requiredDnsRecords =
        getMailDomainOwnershipToken(storedDomain.requiredDnsRecords) == null
          ? createMailDomainDnsRecords({
              dkimTokens: getDkimTokens(identity),
              domain,
              ownershipToken: createMailDomainOwnershipToken(),
              region: getAwsRegion(),
            })
          : storedDomain.requiredDnsRecords;
      let checks = [
        createSesIdentityCheck(identity),
        createSesMailFromCheck(identity),
        ...(await checkMailDomainDnsRecords(defaultDnsLookup, requiredDnsRecords)),
      ];
      const now = new Date();
      let status = aggregateMailDomainStatus(checks);

      if (status === MAIL_DOMAIN_STATUS_VERIFIED) {
        try {
          await ensureReceiptRule(domain);
          checks = [
            ...checks,
            {
              expected: ["Mail receipt rule configured"],
              found: ["Mail receipt rule configured"],
              message: "Mail receipt rule is configured.",
              ok: true,
              purpose: "receipt_rule",
            },
          ];
        } catch (error) {
          checks = [
            ...checks,
            {
              expected: ["Mail receipt rule configured"],
              found: [],
              message:
                error instanceof Error
                  ? error.message
                  : "Mail receipt rule could not be configured.",
              ok: false,
              purpose: "receipt_rule",
            },
          ];
          status = aggregateMailDomainStatus(checks);
        }
      }

      const verifiedAt =
        (status === MAIL_DOMAIN_STATUS_VERIFIED && (storedDomain.verifiedAt ?? now)) || null;
      const lastCheckResult = {
        checkedAt: now.toISOString(),
        checks,
      } satisfies MailDomainCheckResult;

      await db
        .update(mailDomain)
        .set({
          lastCheckResult,
          requiredDnsRecords,
          status,
          updatedAt: now,
          verifiedAt,
        })
        .where(eq(mailDomain.id, storedDomain.id));

      return {
        checks,
        domain,
        domainId: storedDomain.id,
        status,
        verifiedAt,
      };
    }),

  remove: protectedProcedure
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      const [storedDomain] = await db
        .select({
          domain: mailDomain.domain,
          id: mailDomain.id,
        })
        .from(mailDomain)
        .where(
          and(
            eq(mailDomain.id, input.domainId),
            eq(mailDomain.organizationId, input.organizationId),
          ),
        )
        .limit(1);

      if (!storedDomain) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mail domain was not found in the active organization.",
        });
      }

      await db.delete(mailDomain).where(eq(mailDomain.id, storedDomain.id));
      const awsCleanupCompleted = await deleteMailDomainAwsResources(storedDomain.domain);

      return {
        awsCleanupCompleted,
        domain: storedDomain.domain,
        domainId: storedDomain.id,
        removed: true,
      };
    }),
};
