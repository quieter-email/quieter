import { ORPCError } from "@orpc/server";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import { mailbox, mailDomain } from "@quieter/database/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { setMailDomainCatchAll } from "../mail-domain/catch-all";
import {
  getDomainConnectAvailability,
  startDomainConnect,
} from "../mail-domain/domain-connect-service";
import {
  createMailDomainDnsRecords,
  createMailDomainOwnershipToken,
  getMailDomainOwnershipToken,
  normalizeMailDomain,
  normalizeMailDomainDnsRecords,
} from "../mail-domain/records";
import {
  assertUserCanManageMailDomains,
  assertUserOrganizationMember,
  createOrLoadEmailIdentity,
  deleteMailDomainAwsResources,
  deleteMailDomainReceiptRule,
  ensureMailFromDomain,
  getAwsRegion,
  getDkimTokens,
  getEmailIdentity,
} from "../mail-domain/service";
import { verifyMailDomainSetup } from "../mail-domain/verification";
import { protectedProcedure } from "./base";

const mailDomainModeSchema = z.enum(["send_only", "send_and_receive"]);

const assertDomainBillingAccess = async (organizationId: string) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationDomains",
    organizationId,
  });
  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: "Custom team domains require Team billing.",
    });
  }
};

const countManagedMailboxesForDomain = async (input: {
  domain: string;
  organizationId: string;
}) => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, "managed"),
        sql`lower(split_part(${mailbox.emailAddress}, '@', 2)) = ${input.domain}`
      )
    );
  return result?.count ?? 0;
};

const buildMailDomainCatchAll = (row: {
  catchAllMailboxAddress: string | null;
  catchAllMailboxId: string | null;
  domain: string;
}) => {
  if (row.catchAllMailboxId === null || row.catchAllMailboxAddress === null) {
    return null;
  }
  return {
    emailAddress: row.catchAllMailboxAddress,
    mailboxId: row.catchAllMailboxId,
    pattern: `*@${row.domain}`,
  };
};

const updateExistingMailDomainSetup = async (input: {
  domain: string;
  existingDomain: {
    id: string;
    mode: (typeof mailDomain.$inferSelect)["mode"];
    requiredDnsRecords: (typeof mailDomain.$inferSelect)["requiredDnsRecords"];
    status: (typeof mailDomain.$inferSelect)["status"];
    verifiedAt: (typeof mailDomain.$inferSelect)["verifiedAt"];
  };
  mailFromDomain: string;
  mode: (typeof mailDomain.$inferSelect)["mode"];
  records: ReturnType<typeof createMailDomainDnsRecords>;
}) => {
  const ownershipToken = getMailDomainOwnershipToken(
    input.existingDomain.requiredDnsRecords
  );
  const hasOwnershipRecord =
    ownershipToken !== null && ownershipToken.length > 0;
  const status = hasOwnershipRecord
    ? input.existingDomain.status
    : "pending_dns";
  const now = new Date();
  const [updatedDomain] = await db
    .update(mailDomain)
    .set({
      mailFromDomain: input.mailFromDomain,
      requiredDnsRecords: input.records,
      status,
      updatedAt: now,
      verifiedAt: hasOwnershipRecord ? input.existingDomain.verifiedAt : null,
    })
    .where(eq(mailDomain.id, input.existingDomain.id))
    .returning({
      id: mailDomain.id,
      status: mailDomain.status,
    });

  return {
    domain: input.domain,
    domainId: updatedDomain?.id ?? input.existingDomain.id,
    mode: input.mode,
    records: input.records,
    status: updatedDomain?.status ?? status,
  };
};

const createNewMailDomainSetup = async (input: {
  contextUserId: string;
  domain: string;
  mailFromDomain: string;
  mode: (typeof mailDomain.$inferSelect)["mode"];
  organizationId: string;
  records: ReturnType<typeof createMailDomainDnsRecords>;
}) => {
  const now = new Date();
  const id = crypto.randomUUID();
  const [createdDomain] = await db
    .insert(mailDomain)
    .values({
      createdAt: now,
      domain: input.domain,
      id,
      lastCheckResult: null,
      mailFromDomain: input.mailFromDomain,
      mode: input.mode,
      modeUpdatedAt: now,
      modeUpdatedByUserId: input.contextUserId,
      organizationId: input.organizationId,
      requiredDnsRecords: input.records,
      status: "pending_dns",
      updatedAt: now,
      verifiedAt: null,
    })
    .returning({
      id: mailDomain.id,
      status: mailDomain.status,
    });

  return {
    domain: input.domain,
    domainId: createdDomain?.id ?? id,
    mode: input.mode,
    records: input.records,
    status: createdDomain?.status ?? "pending_dns",
  };
};

export const mailDomainsRouter = {
  checkSetup: protectedProcedure
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      await assertDomainBillingAccess(input.organizationId);
      return await verifyMailDomainSetup(input);
    }),

  createSetup: protectedProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        mode: mailDomainModeSchema,
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      await assertDomainBillingAccess(input.organizationId);

      const domain = normalizeMailDomain(input.domain);
      const [existingDomain] = await db
        .select({
          id: mailDomain.id,
          mode: mailDomain.mode,
          organizationId: mailDomain.organizationId,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
          status: mailDomain.status,
          verifiedAt: mailDomain.verifiedAt,
        })
        .from(mailDomain)
        .where(eq(mailDomain.domain, domain))
        .limit(1);

      if (
        existingDomain !== undefined &&
        existingDomain.organizationId !== input.organizationId
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This domain is already registered to another team.",
        });
      }

      const mode = existingDomain?.mode ?? input.mode;
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
        mode,
        ownershipToken:
          getMailDomainOwnershipToken(
            existingDomain?.requiredDnsRecords ?? []
          ) ?? createMailDomainOwnershipToken(),
        region,
      });
      if (existingDomain !== undefined) {
        return await updateExistingMailDomainSetup({
          domain,
          existingDomain,
          mailFromDomain,
          mode,
          records,
        });
      }

      return await createNewMailDomainSetup({
        contextUserId: context.userId,
        domain,
        mailFromDomain,
        mode,
        organizationId: input.organizationId,
        records,
      });
    }),

  get: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserOrganizationMember({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      const [domain] = await db
        .select({
          catchAllMailboxAddress: mailbox.emailAddress,
          catchAllMailboxId: mailDomain.catchAllMailboxId,
          createdAt: mailDomain.createdAt,
          domain: mailDomain.domain,
          id: mailDomain.id,
          lastCheckResult: mailDomain.lastCheckResult,
          mailFromDomain: mailDomain.mailFromDomain,
          mode: mailDomain.mode,
          modeUpdatedAt: mailDomain.modeUpdatedAt,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
          status: mailDomain.status,
          updatedAt: mailDomain.updatedAt,
          verifiedAt: mailDomain.verifiedAt,
        })
        .from(mailDomain)
        .leftJoin(mailbox, eq(mailbox.id, mailDomain.catchAllMailboxId))
        .where(
          and(
            eq(mailDomain.id, input.domainId),
            eq(mailDomain.organizationId, input.organizationId)
          )
        )
        .limit(1);
      if (domain === undefined) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mail domain was not found in the active team.",
        });
      }

      const managedMailboxCount = await countManagedMailboxesForDomain({
        domain: domain.domain,
        organizationId: input.organizationId,
      });
      const { catchAllMailboxAddress, catchAllMailboxId, ...domainDetail } =
        domain;
      return {
        catchAll: buildMailDomainCatchAll({
          catchAllMailboxAddress,
          catchAllMailboxId,
          domain: domainDetail.domain,
        }),
        domain: {
          ...domainDetail,
          requiredDnsRecords: normalizeMailDomainDnsRecords(
            domain.requiredDnsRecords
          ),
        },
        managedMailboxCount,
        modeChangeBlockedReason:
          domain.mode === "send_and_receive" && managedMailboxCount > 0
            ? `${managedMailboxCount} shared ${managedMailboxCount === 1 ? "inbox uses" : "inboxes use"} incoming mail on this domain. Remove or migrate them before switching to send only.`
            : null,
      };
    }),

  getDomainConnectAvailability: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await getDomainConnectAvailability({ ...input, userId: context.userId })
    ),

  list: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserOrganizationMember({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      const domains = await db
        .select({
          catchAllMailboxAddress: mailbox.emailAddress,
          catchAllMailboxId: mailDomain.catchAllMailboxId,
          createdAt: mailDomain.createdAt,
          domain: mailDomain.domain,
          id: mailDomain.id,
          lastCheckResult: mailDomain.lastCheckResult,
          mailFromDomain: mailDomain.mailFromDomain,
          mode: mailDomain.mode,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
          status: mailDomain.status,
          updatedAt: mailDomain.updatedAt,
          verifiedAt: mailDomain.verifiedAt,
        })
        .from(mailDomain)
        .leftJoin(mailbox, eq(mailbox.id, mailDomain.catchAllMailboxId))
        .where(eq(mailDomain.organizationId, input.organizationId))
        .orderBy(desc(mailDomain.createdAt));

      return {
        domains: domains.map(
          ({ catchAllMailboxAddress, catchAllMailboxId, ...domain }) => ({
            catchAll: buildMailDomainCatchAll({
              catchAllMailboxAddress,
              catchAllMailboxId,
              domain: domain.domain,
            }),
            ...domain,
            requiredDnsRecords: normalizeMailDomainDnsRecords(
              domain.requiredDnsRecords
            ),
          })
        ),
      };
    }),

  remove: protectedProcedure
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      })
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
            eq(mailDomain.organizationId, input.organizationId)
          )
        )
        .limit(1);
      if (storedDomain === undefined) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mail domain was not found in the active team.",
        });
      }

      const managedMailboxCount = await countManagedMailboxesForDomain({
        domain: storedDomain.domain,
        organizationId: input.organizationId,
      });
      if (managedMailboxCount > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Remove or migrate the ${managedMailboxCount} shared ${managedMailboxCount === 1 ? "inbox" : "inboxes"} on this domain first.`,
        });
      }

      const awsCleanupCompleted = await deleteMailDomainAwsResources(
        storedDomain.domain
      );
      if (!awsCleanupCompleted) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "The domain could not be removed completely. Try again.",
        });
      }
      await db.delete(mailDomain).where(eq(mailDomain.id, storedDomain.id));

      return {
        awsCleanupCompleted,
        domain: storedDomain.domain,
        domainId: storedDomain.id,
        removed: true,
      };
    }),

  setCatchAll: protectedProcedure
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        mailboxId: z.string().trim().min(1).nullable(),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      await assertDomainBillingAccess(input.organizationId);
      return await setMailDomainCatchAll(input);
    }),

  startDomainConnect: protectedProcedure
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertDomainBillingAccess(input.organizationId);
      return await startDomainConnect({ ...input, userId: context.userId });
    }),

  updateMode: protectedProcedure
    .input(
      z.object({
        domainId: z.string().trim().min(1),
        mode: mailDomainModeSchema,
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageMailDomains({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      await assertDomainBillingAccess(input.organizationId);

      const [storedDomain] = await db
        .select({
          domain: mailDomain.domain,
          id: mailDomain.id,
          mode: mailDomain.mode,
          requiredDnsRecords: mailDomain.requiredDnsRecords,
        })
        .from(mailDomain)
        .where(
          and(
            eq(mailDomain.id, input.domainId),
            eq(mailDomain.organizationId, input.organizationId)
          )
        )
        .limit(1);
      if (storedDomain === undefined) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mail domain was not found in the active team.",
        });
      }
      if (storedDomain.mode === input.mode) {
        return await verifyMailDomainSetup(input);
      }

      if (input.mode === "send_only") {
        const managedMailboxCount = await countManagedMailboxesForDomain({
          domain: storedDomain.domain,
          organizationId: input.organizationId,
        });
        if (managedMailboxCount > 0) {
          throw new ORPCError("CONFLICT", {
            message: `${managedMailboxCount} shared ${managedMailboxCount === 1 ? "inbox uses" : "inboxes use"} incoming mail on this domain. Remove or migrate them before switching to send only.`,
          });
        }
        if (!(await deleteMailDomainReceiptRule(storedDomain.domain))) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Incoming mail could not be disabled. Try again.",
          });
        }
      }

      const identity = await getEmailIdentity(storedDomain.domain);
      const records = createMailDomainDnsRecords({
        dkimTokens: getDkimTokens(identity),
        domain: storedDomain.domain,
        mode: input.mode,
        ownershipToken:
          getMailDomainOwnershipToken(storedDomain.requiredDnsRecords) ??
          createMailDomainOwnershipToken(),
        region: getAwsRegion(),
      });
      const now = new Date();
      await db
        .update(mailDomain)
        .set({
          lastCheckResult: null,
          mode: input.mode,
          modeUpdatedAt: now,
          modeUpdatedByUserId: context.userId,
          requiredDnsRecords: records,
          status: "pending_dns",
          updatedAt: now,
          verifiedAt: null,
        })
        .where(eq(mailDomain.id, storedDomain.id));

      return await verifyMailDomainSetup(input);
    }),
};
