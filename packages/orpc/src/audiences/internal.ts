import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  organizationAudience,
  organizationAudienceLifecycleEvent,
  organizationAudienceMembership,
  organizationAudienceOperation,
  organizationContact,
  organizationMailRecipientSuppression,
} from "@quieter/database/schema";
import { audienceContactSchema } from "@quieter/mail/audiences";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { assertGrowthAccess } from "../growth-access";
import type { GrowthActor, GrowthScope } from "../growth-access";

export type Membership = typeof organizationAudienceMembership.$inferSelect;

export const authorizeAudience = async (
  actor: GrowthActor,
  organizationId: string,
  scope: GrowthScope
) => {
  if (actor.organizationId !== organizationId) {
    throw new ORPCError("FORBIDDEN", {
      message: "This organization is not available to this account.",
    });
  }
  await assertGrowthAccess(actor, scope);
};

export const requireAudience = async (
  database: DatabaseExecutor,
  organizationId: string,
  audienceId: string
) => {
  const [audience] = await database
    .select()
    .from(organizationAudience)
    .where(
      and(
        eq(organizationAudience.organizationId, organizationId),
        eq(organizationAudience.id, audienceId)
      )
    )
    .limit(1);
  if (audience === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Audience not found." });
  }
  return audience;
};

export const requireMembership = async (
  database: DatabaseExecutor,
  input: { organizationId: string; audienceId: string; membershipId: string }
) => {
  const [membership] = await database
    .select()
    .from(organizationAudienceMembership)
    .where(
      and(
        eq(organizationAudienceMembership.organizationId, input.organizationId),
        eq(organizationAudienceMembership.audienceId, input.audienceId),
        eq(organizationAudienceMembership.id, input.membershipId)
      )
    )
    .limit(1);
  if (membership === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Contact not found in this audience.",
    });
  }
  return membership;
};

export const getContact = async (
  database: DatabaseExecutor,
  input: { organizationId: string; audienceId: string; membershipId: string }
) => {
  const [row] = await database
    .select({
      consentOccurredAt: organizationAudienceMembership.consentOccurredAt,
      consentSource: organizationAudienceMembership.consentSource,
      contactId: organizationContact.id,
      createdAt: organizationAudienceMembership.createdAt,
      email: organizationContact.email,
      id: organizationAudienceMembership.id,
      lastLifecycleOccurredAt:
        organizationAudienceMembership.lastLifecycleOccurredAt,
      name: organizationContact.name,
      status: organizationAudienceMembership.status,
      suppression: {
        createdAt: organizationMailRecipientSuppression.createdAt,
        reason: organizationMailRecipientSuppression.reason,
      },
      tags: organizationAudienceMembership.tags,
      updatedAt: organizationAudienceMembership.updatedAt,
    })
    .from(organizationAudienceMembership)
    .innerJoin(
      organizationContact,
      and(
        eq(
          organizationContact.organizationId,
          organizationAudienceMembership.organizationId
        ),
        eq(organizationContact.id, organizationAudienceMembership.contactId)
      )
    )
    .leftJoin(
      organizationMailRecipientSuppression,
      and(
        eq(
          organizationMailRecipientSuppression.organizationId,
          organizationContact.organizationId
        ),
        eq(
          organizationMailRecipientSuppression.recipient,
          organizationContact.email
        ),
        isNull(organizationMailRecipientSuppression.revokedAt)
      )
    )
    .where(
      and(
        eq(organizationAudienceMembership.organizationId, input.organizationId),
        eq(organizationAudienceMembership.audienceId, input.audienceId),
        eq(organizationAudienceMembership.id, input.membershipId)
      )
    )
    .limit(1);
  if (row === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Contact not found in this audience.",
    });
  }
  return audienceContactSchema.parse({
    ...row,
    consentOccurredAt: row.consentOccurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lastLifecycleOccurredAt: row.lastLifecycleOccurredAt.toISOString(),
    suppression: row.suppression
      ? {
          ...row.suppression,
          createdAt: row.suppression.createdAt.toISOString(),
        }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  });
};

export const runAudienceOperation = async <Result>(
  database: DatabaseTransaction,
  input: { organizationId: string; idempotencyKey: string },
  operation: string,
  payload: unknown,
  output: z.ZodType<Result>,
  run: () => Promise<Result>
): Promise<Result> => {
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({ operation, payload }, (_key, value: unknown) => {
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          return Object.fromEntries(
            Object.entries(value).toSorted(([left], [right]) =>
              left.localeCompare(right)
            )
          );
        }
        return value;
      })
    )
    .digest("hex");
  const [claimed] = await database
    .insert(organizationAudienceOperation)
    .values({
      createdAt: new Date(),
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      inputHash,
      operation,
      organizationId: input.organizationId,
    })
    .onConflictDoNothing()
    .returning({ id: organizationAudienceOperation.id });
  if (claimed === undefined) {
    const [prior] = await database
      .select()
      .from(organizationAudienceOperation)
      .where(
        and(
          eq(
            organizationAudienceOperation.organizationId,
            input.organizationId
          ),
          eq(organizationAudienceOperation.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (
      prior === undefined ||
      prior.inputHash !== inputHash ||
      prior.operation !== operation
    ) {
      throw new ORPCError("CONFLICT", {
        message: "This idempotency key was already used with different input.",
      });
    }
    return output.parse(prior.result);
  }
  const result = await run();
  await database
    .update(organizationAudienceOperation)
    .set({ result })
    .where(eq(organizationAudienceOperation.id, claimed.id));
  return result;
};

export const appendLifecycleEvent = async (
  database: DatabaseTransaction,
  input: {
    actor: GrowthActor | null;
    membership: Membership;
    eventType: string;
    occurredAt: Date;
    channel: string;
    source: string;
    reason?: string | null;
    beforeStatus: Membership["status"] | null;
    afterStatus: Membership["status"];
    applied: boolean;
  }
) => {
  let actorType: "user" | "api_key" | "recipient" = "recipient";
  if (input.actor !== null) {
    actorType = input.actor.userId === undefined ? "api_key" : "user";
  }
  await database.insert(organizationAudienceLifecycleEvent).values({
    actorId: input.actor?.userId ?? input.actor?.apiKeyId ?? null,
    actorType,
    afterStatus: input.afterStatus,
    applied: input.applied,
    audienceId: input.membership.audienceId,
    beforeStatus: input.beforeStatus,
    channel: input.channel,
    contactId: input.membership.contactId,
    eventType: input.eventType,
    id: randomUUID(),
    membershipId: input.membership.id,
    occurredAt: input.occurredAt,
    organizationId: input.membership.organizationId,
    reason: input.reason ?? null,
    recordedAt: new Date(),
    source: input.source,
  });
};

export const assertOccurrenceTime = (occurredAt: Date) => {
  if (occurredAt.getTime() > Date.now()) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The event time cannot be in the future.",
    });
  }
};
