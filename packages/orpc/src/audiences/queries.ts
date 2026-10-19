import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  organization,
  organizationAudience,
  organizationAudienceLifecycleEvent,
  organizationAudienceMembership,
  organizationContact,
  organizationMailRecipientSuppression,
} from "@quieter/database/schema";
import {
  audienceCreateInputSchema,
  audienceGetInputSchema,
  audienceListContactsInputSchema,
  audienceListHistoryInputSchema,
  audienceListInputSchema,
  audienceSchema,
  audienceUpdateInputSchema,
} from "@quieter/mail/audiences";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { z } from "zod";

import type { GrowthActor } from "../growth-access";
import {
  audienceTagConditions,
  loadSegmentCriteria,
  lockAudienceForSnapshot,
} from "./eligibility";
import {
  authorizeAudience,
  getContact,
  requireAudience,
  runAudienceOperation,
} from "./internal";

const getAudienceSummary = async (
  database: DatabaseExecutor,
  input: { organizationId: string; audienceId: string }
) => {
  const audience = await requireAudience(
    database,
    input.organizationId,
    input.audienceId
  );
  const [counts] = await database
    .select({
      contactCount: count(),
      subscribedCount:
        sql<number>`count(*) filter (where ${organizationAudienceMembership.status} = 'subscribed')`.mapWith(
          Number
        ),
    })
    .from(organizationAudienceMembership)
    .where(
      and(
        eq(organizationAudienceMembership.organizationId, input.organizationId),
        eq(organizationAudienceMembership.audienceId, input.audienceId)
      )
    );
  return audienceSchema.parse({
    ...audience,
    createdAt: audience.createdAt.toISOString(),
    updatedAt: audience.updatedAt.toISOString(),
    ...counts,
  });
};

export const list = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceListInputSchema>
) => {
  const input = audienceListInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:read");
  const rows = await db
    .select()
    .from(organizationAudience)
    .where(
      and(
        eq(organizationAudience.organizationId, input.organizationId),
        input.cursor ? gt(organizationAudience.id, input.cursor) : undefined,
        input.search
          ? ilike(organizationAudience.name, `%${input.search}%`)
          : undefined
      )
    )
    .orderBy(organizationAudience.id)
    .limit(input.limit + 1);
  const items = await Promise.all(
    rows.slice(0, input.limit).map(
      async (row) =>
        await getAudienceSummary(db, {
          audienceId: row.id,
          organizationId: input.organizationId,
        })
    )
  );
  return {
    items,
    nextCursor: rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
  };
};

export const get = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceGetInputSchema>
) => {
  const input = audienceGetInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:read");
  return await getAudienceSummary(db, input);
};

export const create = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceCreateInputSchema>
) => {
  const input = audienceCreateInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await transaction
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    return await runAudienceOperation(
      transaction,
      input,
      "create",
      input,
      audienceSchema,
      async () => {
        const now = new Date();
        const audienceId = randomUUID();
        await transaction.insert(organizationAudience).values({
          createdAt: now,
          description: input.description ?? null,
          id: audienceId,
          name: input.name,
          organizationId: input.organizationId,
          updatedAt: now,
        });
        return await getAudienceSummary(transaction, {
          audienceId,
          organizationId: input.organizationId,
        });
      }
    );
  });
};

export const update = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceUpdateInputSchema>
) => {
  const input = audienceUpdateInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    await transaction
      .update(organizationAudience)
      .set({
        description: input.description,
        name: input.name,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationAudience.organizationId, input.organizationId),
          eq(organizationAudience.id, input.audienceId)
        )
      );
    return await getAudienceSummary(transaction, input);
  });
};

export const listContacts = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceListContactsInputSchema>
) => {
  const input = audienceListContactsInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:read");
  await requireAudience(db, input.organizationId, input.audienceId);
  const criteria = await loadSegmentCriteria(db, input);
  let suppressionCondition: SQL | undefined;
  if (input.suppression === "suppressed") {
    suppressionCondition = isNotNull(
      organizationMailRecipientSuppression.recipient
    );
  } else if (input.suppression === "clear") {
    suppressionCondition = isNull(
      organizationMailRecipientSuppression.recipient
    );
  }
  const rows = await db
    .select({ id: organizationAudienceMembership.id })
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
        input.cursor
          ? gt(organizationAudienceMembership.id, input.cursor)
          : undefined,
        input.status
          ? eq(organizationAudienceMembership.status, input.status)
          : undefined,
        input.tag
          ? sql`${organizationAudienceMembership.tags} @> ${JSON.stringify([input.tag])}::jsonb`
          : undefined,
        input.search
          ? or(
              ilike(organizationContact.email, `%${input.search}%`),
              ilike(organizationContact.name, `%${input.search}%`)
            )
          : undefined,
        suppressionCondition,
        ...(criteria ? audienceTagConditions(criteria) : [])
      )
    )
    .orderBy(organizationAudienceMembership.id)
    .limit(input.limit + 1);
  const items = await Promise.all(
    rows
      .slice(0, input.limit)
      .map(
        async (row) => await getContact(db, { ...input, membershipId: row.id })
      )
  );
  return {
    items,
    nextCursor: rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
  };
};

export const listHistory = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceListHistoryInputSchema>
) => {
  const input = audienceListHistoryInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:read");
  await requireAudience(db, input.organizationId, input.audienceId);
  const split = input.cursor?.lastIndexOf("~") ?? -1;
  const cursorTime =
    input.cursor && split >= 0 ? new Date(input.cursor.slice(0, split)) : null;
  const cursorId = input.cursor?.slice(split + 1);
  const rows = await db
    .select()
    .from(organizationAudienceLifecycleEvent)
    .where(
      and(
        eq(
          organizationAudienceLifecycleEvent.organizationId,
          input.organizationId
        ),
        eq(organizationAudienceLifecycleEvent.audienceId, input.audienceId),
        input.membershipId
          ? eq(
              organizationAudienceLifecycleEvent.membershipId,
              input.membershipId
            )
          : undefined,
        cursorTime && !Number.isNaN(cursorTime.getTime()) && cursorId
          ? or(
              lt(organizationAudienceLifecycleEvent.recordedAt, cursorTime),
              and(
                eq(organizationAudienceLifecycleEvent.recordedAt, cursorTime),
                lt(organizationAudienceLifecycleEvent.id, cursorId)
              )
            )
          : undefined
      )
    )
    .orderBy(
      desc(organizationAudienceLifecycleEvent.recordedAt),
      desc(organizationAudienceLifecycleEvent.id)
    )
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map((row) => ({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last
        ? `${last.recordedAt}~${last.id}`
        : null,
  };
};
