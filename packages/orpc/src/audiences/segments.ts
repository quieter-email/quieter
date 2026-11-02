import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { organizationAudienceSegment } from "@quieter/database/schema";
import {
  audienceCreateSegmentInputSchema,
  audienceDeleteSegmentInputSchema,
  audienceListSegmentsInputSchema,
  audienceUpdateSegmentInputSchema,
} from "@quieter/mail/audiences";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import type { GrowthActor } from "../growth-access";
import { lockAudienceForSnapshot } from "./eligibility";
import { authorizeAudience, requireAudience } from "./internal";

export const listSegments = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceListSegmentsInputSchema>
) => {
  const input = audienceListSegmentsInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:read");
  await requireAudience(db, input.organizationId, input.audienceId);
  const rows = await db
    .select()
    .from(organizationAudienceSegment)
    .where(
      and(
        eq(organizationAudienceSegment.organizationId, input.organizationId),
        eq(organizationAudienceSegment.audienceId, input.audienceId)
      )
    )
    .orderBy(organizationAudienceSegment.name, organizationAudienceSegment.id);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
};

export const createSegment = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceCreateSegmentInputSchema>
) => {
  const input = audienceCreateSegmentInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    const now = new Date();
    const [segment] = await transaction
      .insert(organizationAudienceSegment)
      .values({
        audienceId: input.audienceId,
        createdAt: now,
        criteria: input.criteria,
        id: randomUUID(),
        name: input.name,
        organizationId: input.organizationId,
        updatedAt: now,
      })
      .returning();
    if (segment === undefined) {
      throw new Error("Segment insert did not produce a segment.");
    }
    return {
      ...segment,
      createdAt: segment.createdAt.toISOString(),
      updatedAt: segment.updatedAt.toISOString(),
    };
  });
};

export const updateSegment = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceUpdateSegmentInputSchema>
) => {
  const input = audienceUpdateSegmentInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    const [segment] = await transaction
      .update(organizationAudienceSegment)
      .set({
        criteria: input.criteria,
        name: input.name,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationAudienceSegment.organizationId, input.organizationId),
          eq(organizationAudienceSegment.audienceId, input.audienceId),
          eq(organizationAudienceSegment.id, input.segmentId)
        )
      )
      .returning();
    if (segment === undefined) {
      throw new ORPCError("NOT_FOUND", {
        message: "Segment not found in this audience.",
      });
    }
    return {
      ...segment,
      createdAt: segment.createdAt.toISOString(),
      updatedAt: segment.updatedAt.toISOString(),
    };
  });
};

export const deleteSegment = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceDeleteSegmentInputSchema>
) => {
  const input = audienceDeleteSegmentInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    const [deleted] = await transaction
      .delete(organizationAudienceSegment)
      .where(
        and(
          eq(organizationAudienceSegment.organizationId, input.organizationId),
          eq(organizationAudienceSegment.audienceId, input.audienceId),
          eq(organizationAudienceSegment.id, input.segmentId)
        )
      )
      .returning({ id: organizationAudienceSegment.id });
    if (deleted === undefined) {
      throw new ORPCError("NOT_FOUND", {
        message: "Segment not found in this audience.",
      });
    }
    return { success: true as const };
  });
};
