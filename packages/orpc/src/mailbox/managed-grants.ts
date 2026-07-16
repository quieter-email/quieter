import type { MailboxGrantRole } from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxAutomationSettings,
  mailboxDivisionGrant,
  mailboxGrant,
  member,
  organizationDivision,
  user,
} from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertOrganizationManager } from "../organization/divisions";
import { getAuthorizedManagedMailbox, MAILBOX_PROVIDER_MANAGED } from "./access";

const normalizeEmailAddress = (emailAddress: string) => emailAddress.trim().toLowerCase();

const getManagedMailboxRecord = async (mailboxId: string) => {
  const [record] = await db
    .select({
      displayName: mailbox.displayName,
      divisionId: mailbox.divisionId,
      emailAddress: mailbox.emailAddress,
      autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
      usefulDetailsEnabled: mailboxAutomationSettings.usefulDetailsEnabled,
      id: mailbox.id,
      includeApiSentMessages: mailbox.includeApiSentMessages,
      organizationId: mailbox.organizationId,
    })
    .from(mailbox)
    .leftJoin(mailboxAutomationSettings, eq(mailboxAutomationSettings.mailboxId, mailbox.id))
    .where(and(eq(mailbox.id, mailboxId), eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)))
    .limit(1);

  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }

  return record;
};

const assertDivisionBelongsToOrganization = async (
  divisionId: string | null | undefined,
  organizationId: string,
) => {
  if (!divisionId) return;
  const [division] = await db
    .select({ id: organizationDivision.id })
    .from(organizationDivision)
    .where(
      and(
        eq(organizationDivision.id, divisionId),
        eq(organizationDivision.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!division) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Division must belong to the managed mailbox team.",
    });
  }
};

export const createManagedMailbox = async (input: {
  divisionId?: string | null;
  displayName?: string | null;
  emailAddress: string;
  includeApiSentMessages?: boolean;
  organizationId: string;
  userId: string;
}) => {
  await assertOrganizationManager({
    organizationId: input.organizationId,
    userId: input.userId,
  });
  await assertDivisionBelongsToOrganization(input.divisionId, input.organizationId);

  const mailboxId = randomUUID();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(mailbox).values({
      createdAt: now,
      displayName: input.displayName?.trim() || null,
      emailAddress: normalizeEmailAddress(input.emailAddress),
      id: mailboxId,
      includeApiSentMessages: input.includeApiSentMessages ?? false,
      divisionId: input.divisionId ?? null,
      organizationId: input.organizationId,
      ownerUserId: null,
      provider: MAILBOX_PROVIDER_MANAGED,
      status: "connected",
      updatedAt: now,
    });
    await tx.insert(mailboxGrant).values({
      createdAt: now,
      id: randomUUID(),
      mailboxId,
      role: "manager",
      updatedAt: now,
      userId: input.userId,
    });
  });
  return { mailboxId };
};

const assertManagedMailboxConfigurator = async (mailboxId: string, userId: string) => {
  const selectedMailbox = await getManagedMailboxRecord(mailboxId);
  try {
    await getAuthorizedManagedMailbox({
      mailboxId,
      requiredRoles: ["manager"],
      userId,
    });
    return selectedMailbox;
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
  }

  await assertOrganizationManager({
    organizationId: selectedMailbox.organizationId,
    userId,
  });

  return selectedMailbox;
};

export const listManagedMailboxAdministration = async (input: {
  organizationId: string;
  userId: string;
}) => {
  await assertOrganizationManager(input);
  const rows = await db
    .select({
      directRole: mailboxGrant.role,
      directUserId: mailboxGrant.userId,
      displayName: mailbox.displayName,
      divisionGrantDivisionId: mailboxDivisionGrant.divisionId,
      divisionGrantRole: mailboxDivisionGrant.role,
      divisionId: mailbox.divisionId,
      divisionName: organizationDivision.name,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      includeApiSentMessages: mailbox.includeApiSentMessages,
      status: mailbox.status,
    })
    .from(mailbox)
    .leftJoin(organizationDivision, eq(organizationDivision.id, mailbox.divisionId))
    .leftJoin(mailboxGrant, eq(mailboxGrant.mailboxId, mailbox.id))
    .leftJoin(mailboxDivisionGrant, eq(mailboxDivisionGrant.mailboxId, mailbox.id))
    .where(
      and(
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
      ),
    );

  const mailboxes = new Map<
    string,
    {
      directGrantCount: number;
      directGrantIds: Set<string>;
      displayName: string | null;
      divisionGrantCount: number;
      divisionGrantIds: Set<string>;
      divisionId: string | null;
      divisionName: string | null;
      emailAddress: string;
      id: string;
      managerGrantIds: Set<string>;
      managerCount: number;
      status: "connected" | "needs_reconnect";
    }
  >();

  for (const row of rows) {
    const record = mailboxes.get(row.id) ?? {
      directGrantCount: 0,
      directGrantIds: new Set<string>(),
      displayName: row.displayName,
      divisionGrantCount: 0,
      divisionGrantIds: new Set<string>(),
      divisionId: row.divisionId,
      divisionName: row.divisionName,
      emailAddress: row.emailAddress,
      id: row.id,
      managerGrantIds: new Set<string>(),
      managerCount: 0,
      status: row.status,
    };
    if (row.directRole && row.directUserId && !record.directGrantIds.has(row.directUserId)) {
      record.directGrantIds.add(row.directUserId);
      record.directGrantCount += 1;
    }
    if (
      row.divisionGrantRole &&
      row.divisionGrantDivisionId &&
      !record.divisionGrantIds.has(row.divisionGrantDivisionId)
    ) {
      record.divisionGrantIds.add(row.divisionGrantDivisionId);
      record.divisionGrantCount += 1;
    }
    if (row.directRole === "manager" && row.directUserId) {
      record.managerGrantIds.add(`direct:${row.directUserId}`);
    }
    if (row.divisionGrantRole === "manager" && row.divisionGrantDivisionId) {
      record.managerGrantIds.add(`division:${row.divisionGrantDivisionId}`);
    }
    record.managerCount = record.managerGrantIds.size;
    mailboxes.set(row.id, record);
  }

  return {
    mailboxes: [...mailboxes.values()].map(
      ({
        directGrantIds: _directGrantIds,
        divisionGrantIds: _divisionGrantIds,
        managerGrantIds: _managerGrantIds,
        ...record
      }) => record,
    ),
  };
};

export const getManagedMailboxDetails = async (input: { mailboxId: string; userId: string }) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(input.mailboxId, input.userId);
  const [directGrants, divisionGrants, selectedDivision] = await Promise.all([
    db
      .select({
        email: user.email,
        name: user.name,
        role: mailboxGrant.role,
        userId: user.id,
      })
      .from(mailboxGrant)
      .innerJoin(user, eq(user.id, mailboxGrant.userId))
      .where(eq(mailboxGrant.mailboxId, input.mailboxId)),
    db
      .select({
        divisionId: organizationDivision.id,
        divisionName: organizationDivision.name,
        role: mailboxDivisionGrant.role,
      })
      .from(mailboxDivisionGrant)
      .innerJoin(organizationDivision, eq(organizationDivision.id, mailboxDivisionGrant.divisionId))
      .where(eq(mailboxDivisionGrant.mailboxId, input.mailboxId)),
    selectedMailbox.divisionId
      ? db
          .select({ id: organizationDivision.id, name: organizationDivision.name })
          .from(organizationDivision)
          .where(eq(organizationDivision.id, selectedMailbox.divisionId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    mailbox: {
      ...selectedMailbox,
      divisionName: selectedDivision[0]?.name ?? null,
      autoLabelEnabled: selectedMailbox.autoLabelEnabled ?? false,
      usefulDetailsEnabled: selectedMailbox.usefulDetailsEnabled ?? false,
      includeApiSentMessages: selectedMailbox.includeApiSentMessages,
    },
    directGrants,
    divisionGrants,
  };
};

export const updateManagedMailbox = async (input: {
  displayName?: string | null;
  divisionId?: string | null;
  includeApiSentMessages?: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(input.mailboxId, input.userId);
  await assertDivisionBelongsToOrganization(input.divisionId, selectedMailbox.organizationId);
  await db
    .update(mailbox)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName?.trim() || null }
        : {}),
      ...(input.divisionId !== undefined ? { divisionId: input.divisionId } : {}),
      ...(input.includeApiSentMessages !== undefined
        ? { includeApiSentMessages: input.includeApiSentMessages }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(mailbox.id, input.mailboxId));

  return { mailboxId: input.mailboxId };
};

export const setManagedMailboxGrant = async (input: {
  mailboxId: string;
  role: MailboxGrantRole;
  targetUserId: string;
  userId: string;
}) => {
  await assertManagedMailboxConfigurator(input.mailboxId, input.userId);
  const [target] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .innerJoin(
      member,
      and(eq(member.organizationId, mailbox.organizationId), eq(member.userId, input.targetUserId)),
    )
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (!target) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Mailbox grants can only be assigned to team members.",
    });
  }

  const now = new Date();
  await db
    .insert(mailboxGrant)
    .values({
      createdAt: now,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      role: input.role,
      updatedAt: now,
      userId: input.targetUserId,
    })
    .onConflictDoUpdate({
      set: { role: input.role, updatedAt: now },
      target: [mailboxGrant.mailboxId, mailboxGrant.userId],
    });
  return { mailboxId: input.mailboxId, role: input.role, userId: input.targetUserId };
};

export const removeManagedMailboxGrant = async (input: {
  mailboxId: string;
  targetUserId: string;
  userId: string;
}) => {
  await assertManagedMailboxConfigurator(input.mailboxId, input.userId);
  const managerGrants = await db
    .select({ userId: mailboxGrant.userId })
    .from(mailboxGrant)
    .where(and(eq(mailboxGrant.mailboxId, input.mailboxId), eq(mailboxGrant.role, "manager")));
  if (
    input.targetUserId === input.userId &&
    managerGrants.length === 1 &&
    managerGrants[0]?.userId === input.userId
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Assign another mailbox manager before removing the last manager.",
    });
  }

  await db
    .delete(mailboxGrant)
    .where(
      and(eq(mailboxGrant.mailboxId, input.mailboxId), eq(mailboxGrant.userId, input.targetUserId)),
    );
  return { removed: true };
};

export const setManagedMailboxDivisionGrant = async (input: {
  divisionId: string;
  mailboxId: string;
  role: MailboxGrantRole;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(input.mailboxId, input.userId);
  await assertDivisionBelongsToOrganization(input.divisionId, selectedMailbox.organizationId);
  const now = new Date();
  await db
    .insert(mailboxDivisionGrant)
    .values({
      createdAt: now,
      divisionId: input.divisionId,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      role: input.role,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { role: input.role, updatedAt: now },
      target: [mailboxDivisionGrant.mailboxId, mailboxDivisionGrant.divisionId],
    });
  return { divisionId: input.divisionId, mailboxId: input.mailboxId, role: input.role };
};

export const removeManagedMailboxDivisionGrant = async (input: {
  divisionId: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertManagedMailboxConfigurator(input.mailboxId, input.userId);
  await db
    .delete(mailboxDivisionGrant)
    .where(
      and(
        eq(mailboxDivisionGrant.mailboxId, input.mailboxId),
        eq(mailboxDivisionGrant.divisionId, input.divisionId),
      ),
    );
  return { removed: true };
};
