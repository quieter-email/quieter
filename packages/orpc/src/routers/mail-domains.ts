import type { GetEmailIdentityCommandOutput } from "@aws-sdk/client-sesv2";
import type { MailDomainCheckResult } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { db, mailDomain } from "@quieter/database";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  aggregateMailDomainStatus,
  assertUserOrganizationMember,
  checkMailDomainDnsRecords,
  createMailDomainDnsRecords,
  createOrLoadEmailIdentity,
  createSesIdentityCheck,
  createSesMailFromCheck,
  defaultDnsLookup,
  ensureMailFromDomain,
  ensureReceiptRule,
  getAwsRegion,
  getDkimTokens,
  getEmailIdentity,
  isSesIdentityVerified,
  MAIL_DOMAIN_STATUS_VERIFIED,
  normalizeMailDomain,
} from "../mail-domain";
import { protectedProcedure } from "./base";

export const mailDomainsRouter = {
  createSetup: protectedProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserOrganizationMember({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      const domain = normalizeMailDomain(input.domain);
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
        region,
      });
      const status: "pending_dns" | "verified" = isSesIdentityVerified(identity)
        ? "verified"
        : "pending_dns";
      const now = new Date();
      const verifiedAt = (status === MAIL_DOMAIN_STATUS_VERIFIED && now) || null;
      const [existingDomain] = await db
        .select({ id: mailDomain.id, createdAt: mailDomain.createdAt })
        .from(mailDomain)
        .where(
          and(eq(mailDomain.organizationId, input.organizationId), eq(mailDomain.domain, domain)),
        )
        .limit(1);

      if (existingDomain) {
        const [updatedDomain] = await db
          .update(mailDomain)
          .set({
            mailFromDomain,
            requiredDnsRecords: records,
            status,
            updatedAt: now,
            verifiedAt,
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
          status,
          updatedAt: now,
          verifiedAt,
        })
        .returning({
          id: mailDomain.id,
          status: mailDomain.status,
        });

      return {
        domain,
        domainId: createdDomain?.id ?? id,
        records,
        status: createdDomain?.status ?? status,
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
      await assertUserOrganizationMember({
        organizationId: input.organizationId,
        userId: context.userId,
      });

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
          message: "Mail domain setup was not found in the active team.",
        });
      }

      let identity: GetEmailIdentityCommandOutput;

      try {
        identity = await getEmailIdentity(domain);
      } catch {
        identity = { $metadata: {} };
      }

      const checks = [
        createSesIdentityCheck(identity),
        createSesMailFromCheck(identity),
        ...(await checkMailDomainDnsRecords(defaultDnsLookup, storedDomain.requiredDnsRecords)),
      ];
      const status = aggregateMailDomainStatus(checks);
      const now = new Date();
      const verifiedAt =
        (status === MAIL_DOMAIN_STATUS_VERIFIED && (storedDomain.verifiedAt ?? now)) || null;
      const lastCheckResult = {
        checkedAt: now.toISOString(),
        checks,
      } satisfies MailDomainCheckResult;

      if (status === MAIL_DOMAIN_STATUS_VERIFIED) {
        await ensureReceiptRule(domain);
      }

      await db
        .update(mailDomain)
        .set({
          lastCheckResult,
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
};
