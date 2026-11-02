import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  organizationAudienceMembership,
  organizationContact,
} from "@quieter/database/schema";
import {
  audienceContactRowSchema,
  audienceContactSchema,
  audienceImportContactsInputSchema,
  audienceImportResultSchema,
  audienceRegisterContactInputSchema,
  audienceUpdateContactInputSchema,
} from "@quieter/mail/audiences";
import type { AudienceImportResult } from "@quieter/mail/audiences";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import type { GrowthActor } from "../growth-access";
import { lockAudienceForSnapshot } from "./eligibility";
import {
  appendLifecycleEvent,
  assertOccurrenceTime,
  authorizeAudience,
  getContact,
  requireMembership,
  runAudienceOperation,
} from "./internal";

const applyRegistration = async (
  transaction: DatabaseTransaction,
  actor: GrowthActor,
  input: {
    organizationId: string;
    audienceId: string;
    email: string;
    name?: string | null;
    tags: string[];
    consentSource: string;
    occurredAt: Date;
    channel: string;
  }
) => {
  const now = new Date();
  await transaction
    .insert(organizationContact)
    .values({
      createdAt: now,
      email: input.email,
      id: randomUUID(),
      name: input.name ?? null,
      organizationId: input.organizationId,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [contact] = await transaction
    .select()
    .from(organizationContact)
    .where(
      and(
        eq(organizationContact.organizationId, input.organizationId),
        eq(organizationContact.email, input.email)
      )
    )
    .limit(1);
  if (contact === undefined) {
    throw new Error("Contact insert did not produce a contact.");
  }
  const [existing] = await transaction
    .select()
    .from(organizationAudienceMembership)
    .where(
      and(
        eq(organizationAudienceMembership.organizationId, input.organizationId),
        eq(organizationAudienceMembership.audienceId, input.audienceId),
        eq(organizationAudienceMembership.contactId, contact.id)
      )
    )
    .limit(1);
  if (existing === undefined) {
    const [membership] = await transaction
      .insert(organizationAudienceMembership)
      .values({
        audienceId: input.audienceId,
        consentOccurredAt: input.occurredAt,
        consentSource: input.consentSource,
        contactId: contact.id,
        createdAt: now,
        id: randomUUID(),
        lastLifecycleOccurredAt: input.occurredAt,
        organizationId: input.organizationId,
        status: "subscribed",
        tags: [...new Set(input.tags)].toSorted(),
        updatedAt: now,
      })
      .returning();
    if (membership === undefined) {
      throw new Error("Membership insert did not produce a membership.");
    }
    await appendLifecycleEvent(transaction, {
      actor,
      afterStatus: "subscribed",
      applied: true,
      beforeStatus: null,
      channel: input.channel,
      eventType: "registered",
      membership,
      occurredAt: input.occurredAt,
      source: input.consentSource,
    });
    return { membershipId: membership.id, status: "created" as const };
  }
  const active = existing.status === "subscribed";
  const fresh =
    input.occurredAt.getTime() >= existing.lastLifecycleOccurredAt.getTime();
  const tags = [...new Set([...existing.tags, ...input.tags])].toSorted();
  const changed =
    active &&
    fresh &&
    (JSON.stringify(tags) !== JSON.stringify(existing.tags) ||
      (input.name !== undefined && input.name !== contact.name));
  if (changed) {
    await transaction
      .update(organizationAudienceMembership)
      .set({ lastLifecycleOccurredAt: input.occurredAt, tags, updatedAt: now })
      .where(
        and(
          eq(
            organizationAudienceMembership.organizationId,
            input.organizationId
          ),
          eq(organizationAudienceMembership.id, existing.id)
        )
      );
    if (input.name !== undefined) {
      await transaction
        .update(organizationContact)
        .set({ name: input.name, updatedAt: now })
        .where(
          and(
            eq(organizationContact.organizationId, input.organizationId),
            eq(organizationContact.id, contact.id)
          )
        );
    }
  }
  let reason: string | null = null;
  if (!active) {
    reason = "Existing subscription state preserved.";
  } else if (!fresh) {
    reason = "A newer lifecycle event already exists.";
  }
  await appendLifecycleEvent(transaction, {
    actor,
    afterStatus: existing.status,
    applied: changed,
    beforeStatus: existing.status,
    channel: input.channel,
    eventType: input.channel === "import" ? "imported" : "registered",
    membership: existing,
    occurredAt: input.occurredAt,
    reason,
    source: input.consentSource,
  });
  let status: "inactive" | "updated" | "unchanged" = "unchanged";
  if (!active) {
    status = "inactive";
  } else if (changed) {
    status = "updated";
  }
  return { membershipId: existing.id, status };
};

export const registerContact = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceRegisterContactInputSchema>
) => {
  const input = audienceRegisterContactInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  assertOccurrenceTime(occurredAt);
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    return await runAudienceOperation(
      transaction,
      input,
      "registerContact",
      input,
      audienceContactSchema,
      async () => {
        const outcome = await applyRegistration(transaction, actor, {
          ...input,
          occurredAt,
        });
        return await getContact(transaction, {
          ...input,
          membershipId: outcome.membershipId,
        });
      }
    );
  });
};

export const importContacts = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceImportContactsInputSchema>
) => {
  const input = audienceImportContactsInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  assertOccurrenceTime(occurredAt);
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    return await runAudienceOperation(
      transaction,
      input,
      "importContacts",
      input,
      audienceImportResultSchema,
      async () => {
        const result: AudienceImportResult = {
          created: 0,
          duplicate: 0,
          inactive: 0,
          invalid: 0,
          rows: [],
          unchanged: 0,
          updated: 0,
        };
        const seen = new Set<string>();
        const validRows: {
          row: z.output<typeof audienceContactRowSchema>;
          index: number;
        }[] = [];
        for (const [index, rawRow] of input.rows.entries()) {
          const parsed = audienceContactRowSchema.safeParse(rawRow);
          if (!parsed.success) {
            result.rows.push({
              message: parsed.error.issues
                .map((issue) => issue.message)
                .join(" "),
              row: index + 1,
              status: "invalid",
            });
            result.invalid += 1;
            continue;
          }
          const row = parsed.data;
          if (seen.has(row.email)) {
            result.rows.push({
              email: row.email,
              message: "This address already appears in this import.",
              row: index + 1,
              status: "duplicate",
            });
            result.duplicate += 1;
            continue;
          }
          seen.add(row.email);
          validRows.push({ index, row });
        }
        for (const { row, index } of validRows.toSorted((left, right) =>
          left.row.email.localeCompare(right.row.email)
        )) {
          const outcome = await applyRegistration(transaction, actor, {
            ...row,
            audienceId: input.audienceId,
            channel: "import",
            consentSource: input.consentSource,
            occurredAt,
            organizationId: input.organizationId,
          });
          result.rows.push({ email: row.email, row: index + 1, ...outcome });
          result[outcome.status] += 1;
        }
        result.rows.sort((left, right) => left.row - right.row);
        return result;
      }
    );
  });
};

export const updateContact = async (
  actor: GrowthActor,
  rawInput: z.input<typeof audienceUpdateContactInputSchema>
) => {
  const input = audienceUpdateContactInputSchema.parse(rawInput);
  await authorizeAudience(actor, input.organizationId, "audiences:write");
  return await db.transaction(async (transaction) => {
    await lockAudienceForSnapshot(
      transaction,
      input.organizationId,
      input.audienceId
    );
    const membership = await requireMembership(transaction, input);
    const now = new Date();
    if (input.name !== undefined) {
      await transaction
        .update(organizationContact)
        .set({ name: input.name, updatedAt: now })
        .where(
          and(
            eq(organizationContact.organizationId, input.organizationId),
            eq(organizationContact.id, membership.contactId)
          )
        );
    }
    await transaction
      .update(organizationAudienceMembership)
      .set({
        lastLifecycleOccurredAt: now,
        tags:
          input.tags === undefined
            ? undefined
            : [...new Set(input.tags)].toSorted(),
        updatedAt: now,
      })
      .where(
        and(
          eq(
            organizationAudienceMembership.organizationId,
            input.organizationId
          ),
          eq(organizationAudienceMembership.id, membership.id)
        )
      );
    await appendLifecycleEvent(transaction, {
      actor,
      afterStatus: membership.status,
      applied: true,
      beforeStatus: membership.status,
      channel: actor.userId === undefined ? "api" : "manual",
      eventType: "edited",
      membership,
      occurredAt: now,
      source: "contact_edit",
    });
    return await getContact(transaction, input);
  });
};
