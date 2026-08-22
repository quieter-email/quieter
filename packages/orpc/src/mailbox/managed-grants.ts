import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  MailboxAccessMode,
  MailboxGrantRole,
} from "@quieter/database/schema";
import {
  mailbox,
  mailboxAutomationSettings,
  mailboxDivisionGrant,
  mailboxGrant,
  mailDomain,
  member,
  organizationDivision,
  user,
} from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

import { assertOrganizationManager } from "../organization/divisions";
import { hasText } from "../text";
import {
  getAuthorizedManagedMailbox,
  MAILBOX_PROVIDER_MANAGED,
} from "./access";

const normalizeEmailAddress = (emailAddress: string) =>
  emailAddress.trim().toLowerCase();

const getManagedMailboxRecord = async (mailboxId: string) => {
  const [record] = await db
    .select({
      accessMode: mailbox.accessMode,
      autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
      displayName: mailbox.displayName,
      divisionId: mailbox.divisionId,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      includeApiSentMessages: mailbox.includeApiSentMessages,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.ownerUserId,
      usefulDetailsEnabled: mailboxAutomationSettings.usefulDetailsEnabled,
    })
    .from(mailbox)
    .leftJoin(
      mailboxAutomationSettings,
      eq(mailboxAutomationSettings.mailboxId, mailbox.id)
    )
    .where(
      and(
        eq(mailbox.id, mailboxId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
      )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }

  return record;
};

const assertDivisionBelongsToOrganization = async (
  divisionId: string | null | undefined,
  organizationId: string
) => {
  if (!hasText(divisionId)) {
    return;
  }
  const [division] = await db
    .select({ id: organizationDivision.id })
    .from(organizationDivision)
    .where(
      and(
        eq(organizationDivision.id, divisionId),
        eq(organizationDivision.organizationId, organizationId)
      )
    )
    .limit(1);

  if (division === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Division must belong to the managed mailbox team.",
    });
  }
};

export const createManagedMailbox = async (input: {
  accessMode?: MailboxAccessMode;
  divisionId?: string | null;
  displayName?: string | null;
  emailAddress: string;
  includeApiSentMessages?: boolean;
  organizationId: string;
  ownerUserId?: string | null;
  userId: string;
}) => {
  await assertOrganizationManager({
    organizationId: input.organizationId,
    userId: input.userId,
  });
  const accessMode = input.accessMode ?? "shared";
  if (accessMode === "private") {
    if (!hasText(input.ownerUserId)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose a team member who owns this private mailbox.",
      });
    }
    if (hasText(input.divisionId)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Private mailboxes cannot belong to a division.",
      });
    }
  }
  const ownerId = accessMode === "private" ? (input.ownerUserId ?? null) : null;

  await assertDivisionBelongsToOrganization(
    accessMode === "private" ? null : input.divisionId,
    input.organizationId
  );
  const emailAddress = normalizeEmailAddress(input.emailAddress);
  const domain = emailAddress.split("@")[1] ?? "";
  const [receivingDomain] = await db
    .select({ id: mailDomain.id })
    .from(mailDomain)
    .where(
      and(
        eq(mailDomain.domain, domain),
        eq(mailDomain.organizationId, input.organizationId),
        eq(mailDomain.status, "verified"),
        eq(mailDomain.mode, "send_and_receive")
      )
    )
    .limit(1);
  if (receivingDomain === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        accessMode === "private"
          ? "Private mailboxes require a verified domain with incoming mail enabled."
          : "Shared inboxes require a verified domain with incoming mail enabled.",
    });
  }

  if (ownerId !== null) {
    const [ownerMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, ownerId),
          eq(member.organizationId, input.organizationId)
        )
      )
      .limit(1);
    if (ownerMembership === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The mailbox owner must be a member of this team.",
      });
    }
  }

  const mailboxId = randomUUID();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(mailbox).values({
      accessMode,
      createdAt: now,
      displayName: hasText(input.displayName) ? input.displayName.trim() : null,
      divisionId: ownerId === null ? (input.divisionId ?? null) : null,
      emailAddress,
      id: mailboxId,
      includeApiSentMessages: input.includeApiSentMessages ?? false,
      organizationId: input.organizationId,
      ownerUserId: ownerId,
      provider: MAILBOX_PROVIDER_MANAGED,
      status: "connected",
      updatedAt: now,
    });
    // Shared mailboxes start with their creator; private mailboxes start with
    // exactly one user, the assigned owner.
    await tx.insert(mailboxGrant).values({
      createdAt: now,
      id: randomUUID(),
      mailboxId,
      role: "manager",
      updatedAt: now,
      userId: ownerId ?? input.userId,
    });
  });
  return { mailboxId };
};

const assertManagedMailboxConfigurator = async (
  mailboxId: string,
  userId: string
) => {
  const selectedMailbox = await getManagedMailboxRecord(mailboxId);
  try {
    await getAuthorizedManagedMailbox({
      mailboxId,
      requiredRoles: ["manager"],
      userId,
    });
    return selectedMailbox;
  } catch (error) {
    if (!(error instanceof ORPCError)) {
      throw error;
    }
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
      accessMode: mailbox.accessMode,
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
      ownerUserId: mailbox.ownerUserId,
      status: mailbox.status,
    })
    .from(mailbox)
    .leftJoin(
      organizationDivision,
      eq(organizationDivision.id, mailbox.divisionId)
    )
    .leftJoin(mailboxGrant, eq(mailboxGrant.mailboxId, mailbox.id))
    .leftJoin(
      mailboxDivisionGrant,
      eq(mailboxDivisionGrant.mailboxId, mailbox.id)
    )
    .where(
      and(
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
      )
    );

  const mailboxes = new Map<
    string,
    {
      accessMode: MailboxAccessMode;
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
      ownerUserId: string | null;
      status: "connected" | "needs_reconnect";
    }
  >();

  for (const row of rows) {
    const record = mailboxes.get(row.id) ?? {
      accessMode: row.accessMode,
      directGrantCount: 0,
      directGrantIds: new Set<string>(),
      displayName: row.displayName,
      divisionGrantCount: 0,
      divisionGrantIds: new Set<string>(),
      divisionId: row.divisionId,
      divisionName: row.divisionName,
      emailAddress: row.emailAddress,
      id: row.id,
      managerCount: 0,
      managerGrantIds: new Set<string>(),
      ownerUserId: row.ownerUserId,
      status: row.status,
    };
    if (
      row.directRole !== null &&
      row.directUserId !== null &&
      !record.directGrantIds.has(row.directUserId)
    ) {
      record.directGrantIds.add(row.directUserId);
      record.directGrantCount += 1;
    }
    if (
      row.divisionGrantRole !== null &&
      row.divisionGrantDivisionId !== null &&
      !record.divisionGrantIds.has(row.divisionGrantDivisionId)
    ) {
      record.divisionGrantIds.add(row.divisionGrantDivisionId);
      record.divisionGrantCount += 1;
    }
    if (row.directRole === "manager" && row.directUserId !== null) {
      record.managerGrantIds.add(`direct:${row.directUserId}`);
    }
    if (
      row.divisionGrantRole === "manager" &&
      row.divisionGrantDivisionId !== null
    ) {
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
      }) => record
    ),
  };
};

export const getManagedMailboxDetails = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  const [directGrants, divisionGrants, ownerProfile, selectedDivision] =
    await Promise.all([
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
        .innerJoin(
          organizationDivision,
          eq(organizationDivision.id, mailboxDivisionGrant.divisionId)
        )
        .where(eq(mailboxDivisionGrant.mailboxId, input.mailboxId)),
      selectedMailbox.ownerUserId === null
        ? Promise.resolve([])
        : db
            .select({ email: user.email, name: user.name })
            .from(user)
            .where(eq(user.id, selectedMailbox.ownerUserId))
            .limit(1),
      selectedMailbox.divisionId === null
        ? Promise.resolve([])
        : db
            .select({
              id: organizationDivision.id,
              name: organizationDivision.name,
            })
            .from(organizationDivision)
            .where(eq(organizationDivision.id, selectedMailbox.divisionId))
            .limit(1),
    ]);

  return {
    directGrants,
    divisionGrants,
    mailbox: {
      ...selectedMailbox,
      autoLabelEnabled: selectedMailbox.autoLabelEnabled ?? false,
      divisionName: selectedDivision[0]?.name ?? null,
      includeApiSentMessages: selectedMailbox.includeApiSentMessages,
      ownerEmail: ownerProfile[0]?.email ?? null,
      ownerName: ownerProfile[0]?.name ?? null,
      usefulDetailsEnabled: selectedMailbox.usefulDetailsEnabled ?? false,
    },
  };
};

export const updateManagedMailbox = async (input: {
  displayName?: string | null;
  divisionId?: string | null;
  includeApiSentMessages?: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  if (
    selectedMailbox.accessMode === "private" &&
    input.divisionId !== undefined
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Private mailboxes cannot belong to a division.",
    });
  }
  await assertDivisionBelongsToOrganization(
    input.divisionId,
    selectedMailbox.organizationId
  );
  await db
    .update(mailbox)
    .set({
      ...(input.displayName === undefined
        ? {}
        : {
            displayName: hasText(input.displayName)
              ? input.displayName.trim()
              : null,
          }),
      ...(input.divisionId === undefined
        ? {}
        : { divisionId: input.divisionId }),
      ...(input.includeApiSentMessages === undefined
        ? {}
        : { includeApiSentMessages: input.includeApiSentMessages }),
      updatedAt: new Date(),
    })
    .where(eq(mailbox.id, input.mailboxId));

  return { mailboxId: input.mailboxId };
};

export const setManagedMailboxAccessMode = async (input: {
  accessMode: MailboxAccessMode;
  mailboxId: string;
  ownerUserId?: string | null;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  if (input.accessMode === selectedMailbox.accessMode) {
    return {
      accessMode: input.accessMode,
      mailboxId: input.mailboxId,
      ownerUserId: selectedMailbox.ownerUserId,
    };
  }

  if (input.accessMode === "private") {
    // Converting a shared inbox locks everyone else out, so only a team
    // owner or admin may perform it.
    await assertOrganizationManager({
      organizationId: selectedMailbox.organizationId,
      userId: input.userId,
    });
    const ownerId = input.ownerUserId ?? null;
    if (!hasText(ownerId)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose a team member who owns this private mailbox.",
      });
    }
    const [ownerMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, selectedMailbox.organizationId),
          eq(member.userId, ownerId)
        )
      )
      .limit(1);
    if (ownerMembership === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The mailbox owner must be a member of this team.",
      });
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .delete(mailboxDivisionGrant)
        .where(eq(mailboxDivisionGrant.mailboxId, input.mailboxId));
      await tx
        .update(mailbox)
        .set({
          accessMode: "private",
          divisionId: null,
          ownerUserId: ownerId,
          updatedAt: now,
        })
        .where(
          and(eq(mailbox.id, input.mailboxId), eq(mailbox.accessMode, "shared"))
        );
      await tx
        .insert(mailboxGrant)
        .values({
          createdAt: now,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          role: "manager",
          updatedAt: now,
          userId: ownerId,
        })
        .onConflictDoUpdate({
          set: { role: "manager", updatedAt: now },
          target: [mailboxGrant.mailboxId, mailboxGrant.userId],
        });
    });
    return {
      accessMode: "private",
      mailboxId: input.mailboxId,
      ownerUserId: ownerId,
    };
  }

  const now = new Date();
  const outgoingOwnerId = selectedMailbox.ownerUserId;
  await db.transaction(async (tx) => {
    // Keep explicit control after ownership is cleared: the outgoing owner
    // retains a manager grant so the shared inbox never loses its managers.
    if (hasText(outgoingOwnerId)) {
      await tx
        .insert(mailboxGrant)
        .values({
          createdAt: now,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          role: "manager",
          updatedAt: now,
          userId: outgoingOwnerId,
        })
        .onConflictDoUpdate({
          set: { role: "manager", updatedAt: now },
          target: [mailboxGrant.mailboxId, mailboxGrant.userId],
        });
    }
    await tx
      .update(mailbox)
      .set({ accessMode: "shared", ownerUserId: null, updatedAt: now })
      .where(
        and(eq(mailbox.id, input.mailboxId), eq(mailbox.accessMode, "private"))
      );
  });
  return {
    accessMode: "shared",
    mailboxId: input.mailboxId,
    ownerUserId: null,
  };
};

export const setManagedMailboxGrant = async (input: {
  mailboxId: string;
  role: MailboxGrantRole;
  targetUserId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  if (
    selectedMailbox.accessMode === "private" &&
    selectedMailbox.ownerUserId === input.targetUserId
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "The mailbox owner always keeps manager access to a private mailbox.",
    });
  }
  const [target] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, mailbox.organizationId),
        eq(member.userId, input.targetUserId)
      )
    )
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (target === undefined) {
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
  return {
    mailboxId: input.mailboxId,
    role: input.role,
    userId: input.targetUserId,
  };
};

export const removeManagedMailboxGrant = async (input: {
  mailboxId: string;
  targetUserId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  if (
    selectedMailbox.accessMode === "private" &&
    selectedMailbox.ownerUserId === input.targetUserId
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "The mailbox owner cannot lose access. Transfer ownership or make the mailbox shared first.",
    });
  }
  const managerGrants = await db
    .select({ userId: mailboxGrant.userId })
    .from(mailboxGrant)
    .where(
      and(
        eq(mailboxGrant.mailboxId, input.mailboxId),
        eq(mailboxGrant.role, "manager")
      )
    );
  if (
    input.targetUserId === input.userId &&
    managerGrants.length === 1 &&
    managerGrants[0]?.userId === input.userId
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Assign another mailbox manager before removing the last manager.",
    });
  }

  await db
    .delete(mailboxGrant)
    .where(
      and(
        eq(mailboxGrant.mailboxId, input.mailboxId),
        eq(mailboxGrant.userId, input.targetUserId)
      )
    );
  return { removed: true };
};

export const setManagedMailboxDivisionGrant = async (input: {
  divisionId: string;
  mailboxId: string;
  role: MailboxGrantRole;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  if (selectedMailbox.accessMode === "private") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Division access isn't available for private mailboxes.",
    });
  }
  await assertDivisionBelongsToOrganization(
    input.divisionId,
    selectedMailbox.organizationId
  );
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
  return {
    divisionId: input.divisionId,
    mailboxId: input.mailboxId,
    role: input.role,
  };
};

export const removeManagedMailboxDivisionGrant = async (input: {
  divisionId: string;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertManagedMailboxConfigurator(
    input.mailboxId,
    input.userId
  );
  if (selectedMailbox.accessMode === "private") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Division access isn't available for private mailboxes.",
    });
  }
  await db
    .delete(mailboxDivisionGrant)
    .where(
      and(
        eq(mailboxDivisionGrant.mailboxId, input.mailboxId),
        eq(mailboxDivisionGrant.divisionId, input.divisionId)
      )
    );
  return { removed: true };
};
