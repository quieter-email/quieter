import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import { mailbox, mailDomain } from "@quieter/database/schema";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { assertDomainBillingAccess } from "../mail-domain/billing";
import { setMailDomainCatchAll } from "../mail-domain/catch-all";
import {
  getDomainConnectAvailability,
  startDomainConnect,
} from "../mail-domain/domain-connect-service";
import {
  assertMailDomainOwnerAvailable,
  withMailDomainLock,
} from "../mail-domain/ownership";
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

const countManagedMailboxesForDomain = async (input: {
  database?: DatabaseExecutor;
  domain: string;
  organizationId: string;
}) => {
  const [result] = await (input.database ?? db)
    .select({ count: count() })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, "managed"),
        eq(
          sql<string>`lower(split_part(${mailbox.emailAddress}, '@', 2))`,
          input.domain
        )
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
  database: DatabaseTransaction;
  domain: string;
  existingDomain: {
    id: string;
    mode: (typeof mailDomain.$inferSelect)["mode"];
    ownershipVerifiedAt: Date | null;
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
  const [updatedDomain] = await input.database
    .update(mailDomain)
    .set({
      mailFromDomain: input.mailFromDomain,
      ownershipVerifiedAt:
        input.existingDomain.ownershipVerifiedAt ??
        (input.existingDomain.status === "verified" ? now : null),
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
  database: DatabaseTransaction;
  contextUserId: string;
  domain: string;
  mailFromDomain: string;
  mode: (typeof mailDomain.$inferSelect)["mode"];
  organizationId: string;
  records: ReturnType<typeof createMailDomainDnsRecords>;
}) => {
  const now = new Date();
  const id = crypto.randomUUID();
  const [createdDomain] = await input.database
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
      return await withMailDomainLock(domain, async (database) => {
        await assertMailDomainOwnerAvailable({
          database,
          domain,
          organizationId: input.organizationId,
        });
        const [existingDomain] = await database
          .select({
            id: mailDomain.id,
            mode: mailDomain.mode,
            organizationId: mailDomain.organizationId,
            ownershipVerifiedAt: mailDomain.ownershipVerifiedAt,
            requiredDnsRecords: mailDomain.requiredDnsRecords,
            status: mailDomain.status,
            verifiedAt: mailDomain.verifiedAt,
          })
          .from(mailDomain)
          .where(
            and(
              eq(mailDomain.domain, domain),
              eq(mailDomain.organizationId, input.organizationId)
            )
          )
          .limit(1);

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
            database,
            domain,
            existingDomain,
            mailFromDomain,
            mode,
            records,
          });
        }

        return await createNewMailDomainSetup({
          contextUserId: context.userId,
          database,
          domain,
          mailFromDomain,
          mode,
          organizationId: input.organizationId,
          records,
        });
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

      return await withMailDomainLock(storedDomain.domain, async (database) => {
        const [lockedDomain] = await database
          .select()
          .from(mailDomain)
          .where(
            and(
              eq(mailDomain.id, storedDomain.id),
              eq(mailDomain.organizationId, input.organizationId)
            )
          )
          .limit(1)
          .for("update");
        if (lockedDomain === undefined) {
          throw new ORPCError("NOT_FOUND", {
            message: "Mail domain was not found in the active team.",
          });
        }
        const managedMailboxCount = await countManagedMailboxesForDomain({
          database,
          domain: storedDomain.domain,
          organizationId: input.organizationId,
        });
        if (managedMailboxCount > 0) {
          throw new ORPCError("CONFLICT", {
            message: `Remove or migrate the ${managedMailboxCount} shared ${managedMailboxCount === 1 ? "inbox" : "inboxes"} on this domain first.`,
          });
        }

        const [otherClaim] = await database
          .select({ id: mailDomain.id })
          .from(mailDomain)
          .where(
            and(
              eq(mailDomain.domain, storedDomain.domain),
              ne(mailDomain.id, storedDomain.id)
            )
          )
          .limit(1);
        let awsCleanupCompleted = true;
        if (otherClaim === undefined) {
          awsCleanupCompleted = await deleteMailDomainAwsResources(
            storedDomain.domain
          );
        } else if (
          lockedDomain.ownershipVerifiedAt !== null ||
          lockedDomain.status === "verified"
        ) {
          awsCleanupCompleted = await deleteMailDomainReceiptRule(
            storedDomain.domain
          );
        }
        if (!awsCleanupCompleted) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "The domain could not be removed completely. Try again.",
          });
        }
        await database
          .delete(mailDomain)
          .where(eq(mailDomain.id, storedDomain.id));

        return {
          awsCleanupCompleted,
          domain: storedDomain.domain,
          domainId: storedDomain.id,
          removed: true,
        };
      });
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
      await withMailDomainLock(storedDomain.domain, async (database) => {
        await assertMailDomainOwnerAvailable({
          database,
          domain: storedDomain.domain,
          organizationId: input.organizationId,
        });
        const [currentDomain] = await database
          .select()
          .from(mailDomain)
          .where(
            and(
              eq(mailDomain.id, storedDomain.id),
              eq(mailDomain.organizationId, input.organizationId)
            )
          )
          .limit(1)
          .for("update");
        if (currentDomain === undefined) {
          throw new ORPCError("NOT_FOUND", {
            message: "Mail domain was not found in the active team.",
          });
        }
        if (currentDomain.mode === input.mode) {
          return;
        }
        const identity = await getEmailIdentity(currentDomain.domain);
        const records = createMailDomainDnsRecords({
          dkimTokens: getDkimTokens(identity),
          domain: currentDomain.domain,
          mode: input.mode,
          ownershipToken:
            getMailDomainOwnershipToken(currentDomain.requiredDnsRecords) ??
            createMailDomainOwnershipToken(),
          region: getAwsRegion(),
        });
        const now = new Date();
        const updateValues = {
          lastCheckResult: null,
          mode: input.mode,
          modeUpdatedAt: now,
          modeUpdatedByUserId: context.userId,
          ownershipVerifiedAt:
            currentDomain.ownershipVerifiedAt ??
            (currentDomain.status === "verified" ? now : null),
          requiredDnsRecords: records,
          status: "pending_dns" as const,
          updatedAt: now,
          verifiedAt: null,
        };
        if (input.mode === "send_only") {
          const managedMailboxCount = await countManagedMailboxesForDomain({
            database,
            domain: currentDomain.domain,
            organizationId: input.organizationId,
          });
          if (managedMailboxCount > 0) {
            throw new ORPCError("CONFLICT", {
              message: `${managedMailboxCount} shared ${managedMailboxCount === 1 ? "inbox uses" : "inboxes use"} incoming mail on this domain. Remove or migrate them before switching to send only.`,
            });
          }
          if (!(await deleteMailDomainReceiptRule(currentDomain.domain))) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Incoming mail could not be disabled. Try again.",
            });
          }
        }
        await database
          .update(mailDomain)
          .set(updateValues)
          .where(eq(mailDomain.id, currentDomain.id));
      });

      return await verifyMailDomainSetup(input);
    }),
};
