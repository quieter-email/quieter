import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  organizationAudience,
  organizationAudienceMembership,
  organizationAudienceSegment,
  organizationContact,
  organizationMailRecipientSuppression,
} from "@quieter/database/schema";
import type { AudienceSegmentCriteria } from "@quieter/mail/audiences";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

export const lockAudienceForSnapshot = async (
  transaction: DatabaseTransaction,
  organizationId: string,
  audienceId: string
) => {
  const [audience] = await transaction
    .select()
    .from(organizationAudience)
    .where(
      and(
        eq(organizationAudience.organizationId, organizationId),
        eq(organizationAudience.id, audienceId)
      )
    )
    .for("update");
  if (audience === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Audience not found." });
  }
  return audience;
};

export const audienceTagConditions = (
  criteria: AudienceSegmentCriteria
): SQL[] => {
  const conditions: SQL[] = criteria.allTags.map(
    (tag) =>
      sql`${organizationAudienceMembership.tags} @> ${JSON.stringify([tag])}::jsonb`
  );
  if (criteria.anyTags.length > 0) {
    conditions.push(
      sql`${organizationAudienceMembership.tags} ?| ARRAY[${sql.join(
        criteria.anyTags.map((tag) => sql`${tag}`),
        sql`, `
      )}]::text[]`
    );
  }
  if (criteria.excludeTags.length > 0) {
    conditions.push(
      sql`not (${organizationAudienceMembership.tags} ?| ARRAY[${sql.join(
        criteria.excludeTags.map((tag) => sql`${tag}`),
        sql`, `
      )}]::text[])`
    );
  }
  return conditions;
};

export const loadSegmentCriteria = async (
  database: DatabaseExecutor,
  input: { organizationId: string; audienceId: string; segmentId?: string }
) => {
  if (!input.segmentId) {
    return null;
  }
  const [segment] = await database
    .select()
    .from(organizationAudienceSegment)
    .where(
      and(
        eq(organizationAudienceSegment.organizationId, input.organizationId),
        eq(organizationAudienceSegment.audienceId, input.audienceId),
        eq(organizationAudienceSegment.id, input.segmentId)
      )
    )
    .limit(1);
  if (segment === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Segment not found in this audience.",
    });
  }
  return segment.criteria;
};

export const selectAudienceRecipients = async (
  transaction: DatabaseTransaction,
  input: {
    organizationId: string;
    audienceId: string;
    segmentId?: string;
    segmentIds?: string[];
  }
) => {
  const segmentIds = [
    ...new Set([
      ...(input.segmentIds ?? []),
      ...(input.segmentId ? [input.segmentId] : []),
    ]),
  ];
  const criteria = await Promise.all(
    segmentIds.map(
      async (segmentId) =>
        await loadSegmentCriteria(transaction, { ...input, segmentId })
    )
  );
  const rows = await transaction
    .select({
      contactId: organizationContact.id,
      email: organizationContact.email,
      membershipId: organizationAudienceMembership.id,
      name: organizationContact.name,
      status: organizationAudienceMembership.status,
      suppressed: organizationMailRecipientSuppression.reason,
      tags: organizationAudienceMembership.tags,
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
        eq(organizationAudienceMembership.audienceId, input.audienceId)
      )
    )
    .orderBy(organizationAudienceMembership.id)
    .limit(10_001);
  if (rows.length > 10_000) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A campaign can include up to 10,000 contacts.",
    });
  }
  return rows.map(({ suppressed, ...row }) => {
    const matchesSegment =
      criteria.length === 0 ||
      criteria.some(
        (selection) =>
          selection !== null &&
          selection.allTags.every((tag) => row.tags.includes(tag)) &&
          (selection.anyTags.length === 0 ||
            selection.anyTags.some((tag) => row.tags.includes(tag))) &&
          selection.excludeTags.every((tag) => !row.tags.includes(tag))
      );
    let exclusionReason: string | null = null;
    if (row.status !== "subscribed") {
      exclusionReason = row.status;
    } else if (suppressed !== null) {
      exclusionReason = "suppressed";
    } else if (!matchesSegment) {
      exclusionReason = "segment_mismatch";
    }
    return { ...row, eligible: exclusionReason === null, exclusionReason };
  });
};

export const checkAudienceRecipientEligibility = async (input: {
  organizationId: string;
  audienceId: string;
  membershipId: string;
  email: string;
}) => {
  const [row] = await db
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
        eq(organizationAudienceMembership.id, input.membershipId),
        eq(organizationAudienceMembership.status, "subscribed"),
        eq(organizationContact.email, input.email),
        isNull(organizationMailRecipientSuppression.recipient)
      )
    )
    .limit(1);
  return row !== undefined;
};
