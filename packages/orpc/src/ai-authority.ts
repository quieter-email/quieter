import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxAiAuthority,
  mailboxPersonalAgentSetting,
} from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { assertAgentMailboxAccess } from "./mail-agent/access";
import { getPersonalActionCutoverError } from "./mail-agent/cutover";
import { getAuthorizedManagedMailbox } from "./mailbox/access";

export const aiOriginSchema = z.strictObject({
  kind: z.literal("ai"),
  mailboxId: z.string().min(1),
  mode: z.enum(["interactive", "automation"]),
  policyVersion: z.number().int().nonnegative(),
  userId: z.string().min(1),
});
export const aiOperationOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human") }),
  aiOriginSchema,
]);

export type AiOperationOrigin = z.infer<typeof aiOperationOriginSchema>;
export type AiOrigin = Extract<AiOperationOrigin, { kind: "ai" }>;
export const mailboxAutomationOriginSchema = z.strictObject({
  kind: z.literal("ai"),
  mailboxId: z.string().min(1),
  mode: z.literal("automation"),
  policyVersion: z.number().int().nonnegative(),
  scope: z.literal("mailbox-automation"),
});
export type MailboxAutomationOrigin = z.infer<
  typeof mailboxAutomationOriginSchema
>;
export type AiAuthorityPolicy = Pick<
  typeof mailboxAiAuthority.$inferSelect,
  "automationPaused" | "readOnly" | "version"
>;
export type AiAuthorityEffect = "read" | "execute" | "write";

export const aiAuthorityInputs = {
  get: z.strictObject({ mailboxId: z.string().min(1) }),
  update: z.strictObject({
    automationPaused: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
    mailboxId: z.string().min(1),
    readOnly: z.boolean(),
  }),
};

export const getAiAuthorityDecision = (input: {
  effect: AiAuthorityEffect;
  origin: AiOperationOrigin | MailboxAutomationOrigin;
  policy: AiAuthorityPolicy;
}) => {
  if (input.origin.kind === "human" || input.effect === "read") {
    return { allowed: true } as const;
  }
  if (input.effect === "write" && input.policy.readOnly) {
    return { allowed: false, reason: "read_only" } as const;
  }
  if (input.origin.mode === "automation" && input.policy.automationPaused) {
    return { allowed: false, reason: "automation_paused" } as const;
  }
  if (input.origin.policyVersion !== input.policy.version) {
    return { allowed: false, reason: "policy_changed" } as const;
  }
  return { allowed: true } as const;
};

const readAiAuthorityPolicy = async (
  mailboxId: string,
  database: Pick<typeof db, "select">
): Promise<AiAuthorityPolicy> => {
  const [policy] = await database
    .select({
      automationPaused: mailboxAiAuthority.automationPaused,
      readOnly: mailboxAiAuthority.readOnly,
      version: mailboxAiAuthority.version,
    })
    .from(mailboxAiAuthority)
    .where(eq(mailboxAiAuthority.mailboxId, mailboxId))
    .limit(1);
  return policy ?? { automationPaused: false, readOnly: false, version: 0 };
};

export const captureAiOrigin = async (
  input: Pick<AiOrigin, "mailboxId" | "mode" | "userId">,
  database: Pick<typeof db, "select"> = db
): Promise<AiOrigin> => {
  await assertAgentMailboxAccess(input, database);
  const policy = await readAiAuthorityPolicy(input.mailboxId, database);
  return { ...input, kind: "ai", policyVersion: policy.version };
};

export const captureMailboxAutomationOrigin = async (
  input: { mailboxId: string },
  database: Pick<typeof db, "select"> = db
): Promise<MailboxAutomationOrigin> => {
  const [record] = await database
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(eq(mailbox.id, input.mailboxId), eq(mailbox.provider, "managed"))
    )
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Inbox not found." });
  }
  const policy = await readAiAuthorityPolicy(input.mailboxId, database);
  return {
    kind: "ai",
    mailboxId: input.mailboxId,
    mode: "automation",
    policyVersion: policy.version,
    scope: "mailbox-automation",
  };
};

export const assertAiAuthority = async (
  input: {
    effect: AiAuthorityEffect;
    mailboxId?: string;
    origin: AiOperationOrigin | MailboxAutomationOrigin;
    userId?: string;
  },
  database: Pick<typeof db, "select"> = db,
  options?: { lock?: boolean }
) => {
  if (input.origin.kind === "human") {
    return;
  }
  const { origin } = input;
  if (
    (input.mailboxId !== undefined && input.mailboxId !== origin.mailboxId) ||
    (input.userId !== undefined &&
      ("scope" in origin || input.userId !== origin.userId))
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "This assistant action belongs to a different inbox or account.",
    });
  }
  if (options?.lock === true) {
    await database
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, origin.mailboxId))
      .for("update");
  }
  if ("scope" in origin) {
    const [record] = await database
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(
        and(eq(mailbox.id, origin.mailboxId), eq(mailbox.provider, "managed"))
      )
      .limit(1);
    if (record === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Inbox not found." });
    }
  } else {
    await assertAgentMailboxAccess(origin, database);
  }
  const policy = await readAiAuthorityPolicy(origin.mailboxId, database);
  const decision = getAiAuthorityDecision({ ...input, policy });
  if (!decision.allowed) {
    const messages = {
      automation_paused:
        "Automatic assistant actions are paused for this inbox.",
      policy_changed:
        "Assistant permissions changed. Start a new request to continue.",
      read_only: "The assistant is read-only for this inbox.",
    };
    throw new ORPCError("FORBIDDEN", {
      data: { aiAuthorityReason: decision.reason },
      message: messages[decision.reason],
    });
  }
};

export const getMailboxAiAuthority = async (
  input: { mailboxId: string; userId: string },
  database: Pick<typeof db, "select"> = db
) => {
  await assertAgentMailboxAccess(input, database);
  const [record] = await database
    .select({ ownerUserId: mailbox.ownerUserId, provider: mailbox.provider })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  const managed =
    record?.provider === "managed"
      ? await getAuthorizedManagedMailbox(input, database)
      : null;
  return {
    ...(await readAiAuthorityPolicy(input.mailboxId, database)),
    canManage:
      managed === null
        ? record?.provider === "gmail" && record.ownerUserId === input.userId
        : managed.role === "manager",
    mailboxId: input.mailboxId,
  };
};

export const updateMailboxAiAuthority = async (
  input: z.infer<typeof aiAuthorityInputs.update> & { userId: string }
) => {
  try {
    return await db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          ownerUserId: mailbox.ownerUserId,
          provider: mailbox.provider,
        })
        .from(mailbox)
        .where(eq(mailbox.id, input.mailboxId))
        .for("update");
      if (record === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Inbox not found." });
      }
      if (record.provider === "managed") {
        await getAuthorizedManagedMailbox(
          { ...input, requiredRoles: ["manager"] },
          tx
        );
      } else if (
        record.provider !== "gmail" ||
        record.ownerUserId !== input.userId
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Inbox not found." });
      }
      const current = await readAiAuthorityPolicy(input.mailboxId, tx);
      if (current.version !== input.expectedVersion) {
        throw new ORPCError("CONFLICT", {
          message: "Assistant permissions changed. Refresh and try again.",
        });
      }
      if (
        current.readOnly === input.readOnly &&
        current.automationPaused === input.automationPaused
      ) {
        return { ...current, canManage: true, mailboxId: input.mailboxId };
      }
      const now = new Date();
      const next = {
        automationPaused: input.automationPaused,
        readOnly: input.readOnly,
        version: current.version + 1,
      };
      await tx
        .insert(mailboxAiAuthority)
        .values({
          ...next,
          createdAt: now,
          mailboxId: input.mailboxId,
          updatedAt: now,
          updatedByUserId: input.userId,
        })
        .onConflictDoUpdate({
          set: { ...next, updatedAt: now, updatedByUserId: input.userId },
          target: mailboxAiAuthority.mailboxId,
        });
      await tx.execute(
        sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
      );
      await tx
        .update(mailboxPersonalAgentSetting)
        .set({
          activationVersion: sql`${mailboxPersonalAgentSetting.version} + 1`,
          updatedAt: now,
          version: sql`${mailboxPersonalAgentSetting.version} + 1`,
        })
        .where(
          and(
            eq(mailboxPersonalAgentSetting.mailboxId, input.mailboxId),
            eq(mailboxPersonalAgentSetting.enabled, true)
          )
        );
      return { ...next, canManage: true, mailboxId: input.mailboxId };
    });
  } catch (error) {
    throw getPersonalActionCutoverError(error) ?? error;
  }
};
