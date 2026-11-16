import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailbox,
  mailMessageOperation,
  mailPlacementOperation,
  mailSnoozeOperation,
  mailUndoAttempt,
} from "@quieter/database/schema";
import {
  mailUndoInputSchema,
  mailUndoOfferSchema,
  mailUndoReceiptIdSchema,
} from "@quieter/mail/undo";
import type {
  MailUndoInput,
  MailUndoOffer,
  MailUndoReceiptId,
} from "@quieter/mail/undo";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";

import {
  admitMailUndo,
  getMailUndoReceipt,
  mailUndoAdmissionSchema,
  mailUndoAttemptSchema,
  mailUndoCurrentMessageSchema,
  mailUndoOriginalSchema,
  mailUndoPlanSchema,
} from "./undo-model";
import type {
  MailUndoAttempt,
  MailUndoOriginal,
  MailUndoPlan,
} from "./undo-model";
import {
  createMailUndoProgress,
  mailUndoExecutionSchema,
  mailUndoProgressEventSchema,
  projectMailUndoProgress,
  transitionMailUndoProgress,
} from "./undo-progress";
import type { MailUndoExecution } from "./undo-progress";

type Authority = z.infer<typeof mailUndoAdmissionSchema.shape.authority>;
type StateInput = { authority: Authority; database: DatabaseTransaction };
type OriginalReaderInput = {
  authority: Authority;
  database: Pick<DatabaseTransaction, "select">;
};
type AttemptRow = typeof mailUndoAttempt.$inferSelect;
type NativeOriginal =
  | { kind: "message"; row: typeof mailMessageOperation.$inferSelect }
  | {
      kind: "placement";
      row: Omit<typeof mailPlacementOperation.$inferSelect, "sequence"> & {
        sequence: string;
      };
    }
  | { kind: "snooze"; row: typeof mailSnoozeOperation.$inferSelect };
type ProgressEvent = z.infer<typeof mailUndoProgressEventSchema>;
const nativeCommandSchema =
  mailUndoProgressEventSchema.options[0].shape.receipt.shape.command;
const sourceIdsSchema = z
  .array(mailUndoCurrentMessageSchema.shape.messageId)
  .max(1000)
  .refine((ids) => new Set(ids).size === ids.length);

export const mailUndoNativeAssociationSchema = z.strictObject({
  attemptId: z.uuid(),
  kind: z.literal("mail-undo-phase"),
  phaseId: z.uuid(),
});

const lockMailbox = async ({ authority, database }: StateInput) => {
  const parsed = mailUndoAdmissionSchema.shape.authority.parse(authority);
  if (!parsed.canWrite) {
    throw new ORPCError("FORBIDDEN", {
      message: "You no longer have permission to undo this action.",
    });
  }
  const [selected] = await database
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(eq(mailbox.id, parsed.mailboxId))
    .for("update");
  if (selected === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This inbox is no longer available.",
    });
  }
  return parsed;
};

const readOriginalRow = async ({
  database,
  authority,
  receiptId,
}: OriginalReaderInput & {
  receiptId: MailUndoReceiptId;
}): Promise<NativeOriginal | null> => {
  const reference = mailUndoReceiptIdSchema.parse(receiptId);
  const operationId = reference.slice(reference.indexOf(":") + 1);
  if (reference.startsWith("message:")) {
    const [row] = await database
      .select()
      .from(mailMessageOperation)
      .where(
        and(
          eq(mailMessageOperation.id, operationId),
          eq(mailMessageOperation.actorUserId, authority.actorUserId),
          eq(mailMessageOperation.mailboxId, authority.mailboxId)
        )
      );
    return row === undefined ? null : { kind: "message", row };
  }
  if (reference.startsWith("placement:")) {
    const [row] = await database
      .select({
        ...getTableColumns(mailPlacementOperation),
        sequence: sql<string>`${mailPlacementOperation.sequence}::text`,
      })
      .from(mailPlacementOperation)
      .where(
        and(
          eq(mailPlacementOperation.id, operationId),
          eq(mailPlacementOperation.actorUserId, authority.actorUserId),
          eq(mailPlacementOperation.mailboxId, authority.mailboxId)
        )
      );
    return row === undefined ? null : { kind: "placement", row };
  }
  const [row] = await database
    .select()
    .from(mailSnoozeOperation)
    .where(
      and(
        eq(mailSnoozeOperation.id, operationId),
        eq(mailSnoozeOperation.actorUserId, authority.actorUserId),
        eq(mailSnoozeOperation.mailboxId, authority.mailboxId)
      )
    );
  return row === undefined ? null : { kind: "snooze", row };
};

const parseOriginal = (
  native: NativeOriginal,
  value: unknown
): MailUndoOriginal | null => {
  const parsed = mailUndoOriginalSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const original = parsed.data;
  const { row } = native;
  if (
    row.status !== "applied" ||
    original.kind !== native.kind ||
    original.operationId !== row.id ||
    original.actorUserId !== row.actorUserId ||
    original.mailboxId !== row.mailboxId ||
    original.threadId !== row.threadId ||
    Date.parse(original.admittedAt) !== row.createdAt.getTime() ||
    original.proof === null
  ) {
    return null;
  }
  if (native.kind === "snooze" && original.kind === "snooze") {
    if (
      original.proof.command !== native.row.kind ||
      original.proof.after.id !== native.row.snoozeId ||
      original.proof.after.version !== native.row.resultingVersion?.toString()
    ) {
      return null;
    }
  } else if (original.kind !== "snooze" && native.kind !== "snooze") {
    const ids = sourceIdsSchema.safeParse(native.row.messageIds);
    const effects = original.proof.effects.map((effect) => effect.messageId);
    if (
      !ids.success ||
      ids.data.length !== effects.length ||
      ids.data.some((id) => !effects.includes(id)) ||
      (native.kind === "placement" &&
        (original.kind !== "placement" ||
          original.proof.acceptedSequence !== native.row.sequence))
    ) {
      return null;
    }
    if (native.kind === "message" && original.kind === "message") {
      const command = nativeCommandSchema.safeParse(native.row.command);
      if (
        !command.success ||
        original.proof.effects.some((effect) =>
          effect.facet === "read"
            ? command.data.facet !== "read" ||
              effect.after !== command.data.read
            : command.data.facet !== "destination" ||
              JSON.stringify(effect.after) !==
                JSON.stringify(command.data.destination)
        )
      ) {
        return null;
      }
    }
    if (
      native.kind === "placement" &&
      original.kind === "placement" &&
      original.proof.effects.some((effect) => {
        const destination = effect.after;
        if (destination.kind === "managed") {
          return destination.value !== native.row.placement;
        }
        return (destination.inbox ? "inbox" : "done") !== native.row.placement;
      })
    ) {
      return null;
    }
  }
  return original;
};

const parseAttempt = (row: AttemptRow): MailUndoAttempt => {
  const liveOriginalOperationId = {
    message: row.liveMessageOperationId,
    placement: row.livePlacementOperationId,
    snooze: row.liveSnoozeOperationId,
  }[row.originalKind];
  return mailUndoAttemptSchema.parse({
    actorUserId: row.actorUserId,
    admittedAt: row.admittedAt.toISOString(),
    cutoff: row.cutoff.toISOString(),
    id: row.id,
    items: row.items,
    liveOriginalOperationId,
    mailboxId: row.mailboxId,
    originalKind: row.originalKind,
    originalOperationId: row.originalOperationId,
    state: row.state,
  });
};

export const getMailUndoOffer = async ({
  authority: candidate,
  database,
  receiptIds,
  now,
}: OriginalReaderInput & {
  now: Date;
  receiptIds: MailUndoReceiptId[];
}): Promise<MailUndoOffer | null> => {
  const authority = mailUndoAdmissionSchema.shape.authority.parse(candidate);
  if (!authority.canWrite || receiptIds.length === 0) {
    return null;
  }
  const input = mailUndoInputSchema.parse({
    mailboxId: authority.mailboxId,
    receipts: receiptIds,
  });
  const receipts = [];
  let sourceCount = 0;
  for (const receiptId of input.receipts) {
    const native = await readOriginalRow({ authority, database, receiptId });
    const original =
      native === null ? null : parseOriginal(native, native.row.undoProof);
    if (original === null || original.proof === null) {
      continue;
    }
    const receipt = getMailUndoReceipt({ now: now.toISOString(), original });
    if (receipt === null) {
      continue;
    }
    sourceCount +=
      original.kind === "snooze"
        ? original.proof.after.hiddenMessageIds.length
        : original.proof.effects.length;
    if (sourceCount > 1000) {
      return null;
    }
    receipts.push(receipt);
  }
  return receipts.length === 0
    ? null
    : mailUndoOfferSchema.parse({ mailboxId: authority.mailboxId, receipts });
};

export const persistMailUndoOriginal = async ({
  database,
  authority,
  original: candidate,
}: StateInput & { original: MailUndoOriginal }): Promise<MailUndoOriginal> => {
  await lockMailbox({ authority, database });
  const parsed = mailUndoOriginalSchema.parse(candidate);
  const receiptId = mailUndoReceiptIdSchema.parse(
    `${parsed.kind}:${parsed.operationId}`
  );
  const native = await readOriginalRow({ authority, database, receiptId });
  const original = native === null ? null : parseOriginal(native, parsed);
  if (original === null || native === null) {
    throw new ORPCError("CONFLICT", {
      message: "This action no longer has a matching confirmed receipt.",
    });
  }
  if (native.row.undoProof !== null) {
    const previous = parseOriginal(native, native.row.undoProof);
    if (
      previous === null ||
      JSON.stringify(previous) !== JSON.stringify(original)
    ) {
      throw new ORPCError("CONFLICT", {
        message: "This action already has different retained evidence.",
      });
    }
    return previous;
  }
  if (native.kind === "message") {
    await database
      .update(mailMessageOperation)
      .set({ undoProof: original })
      .where(
        and(
          eq(mailMessageOperation.id, native.row.id),
          eq(mailMessageOperation.actorUserId, authority.actorUserId),
          eq(mailMessageOperation.mailboxId, authority.mailboxId)
        )
      );
  } else if (native.kind === "placement") {
    await database
      .update(mailPlacementOperation)
      .set({ undoProof: original })
      .where(
        and(
          eq(mailPlacementOperation.id, native.row.id),
          eq(mailPlacementOperation.actorUserId, authority.actorUserId),
          eq(mailPlacementOperation.mailboxId, authority.mailboxId)
        )
      );
  } else {
    await database
      .update(mailSnoozeOperation)
      .set({ undoProof: original })
      .where(
        and(
          eq(mailSnoozeOperation.id, native.row.id),
          eq(mailSnoozeOperation.actorUserId, authority.actorUserId),
          eq(mailSnoozeOperation.mailboxId, authority.mailboxId)
        )
      );
  }
  return original;
};

export type MailUndoAdmission = {
  original: MailUndoOriginal | null;
  receiptId: MailUndoReceiptId;
  result: ReturnType<typeof admitMailUndo>;
};

export const prepareMailUndoRequest = async ({
  authority,
  database,
  input: candidate,
  now,
}: StateInput & { input: MailUndoInput; now: Date }): Promise<
  MailUndoAdmission[]
> => {
  const input = mailUndoInputSchema.parse(candidate);
  if (input.mailboxId !== authority.mailboxId) {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot undo actions in this inbox.",
    });
  }
  const current = await lockMailbox({ authority, database });
  const attempts = new Map<MailUndoReceiptId, AttemptRow>();
  const originals = new Map<MailUndoReceiptId, MailUndoOriginal | null>();
  let sourceCount = 0;
  for (const receiptId of input.receipts) {
    const kind = mailUndoAttemptSchema.shape.originalKind.parse(
      receiptId.slice(0, receiptId.indexOf(":"))
    );
    const operationId = receiptId.slice(receiptId.indexOf(":") + 1);
    const [existing] = await database
      .select()
      .from(mailUndoAttempt)
      .where(
        and(
          eq(mailUndoAttempt.actorUserId, current.actorUserId),
          eq(mailUndoAttempt.mailboxId, current.mailboxId),
          eq(mailUndoAttempt.originalKind, kind),
          eq(mailUndoAttempt.originalOperationId, operationId)
        )
      )
      .for("update");
    if (existing !== undefined) {
      attempts.set(receiptId, existing);
    }
    const native = await readOriginalRow({
      authority: current,
      database,
      receiptId,
    });
    const original =
      native === null ? null : parseOriginal(native, native.row.undoProof);
    originals.set(receiptId, original);
    let resolvedCount = 0;
    if (original?.proof) {
      resolvedCount =
        original.kind === "snooze"
          ? original.proof.after.hiddenMessageIds.length
          : original.proof.effects.length;
    }
    const replayCount =
      existing === undefined
        ? 0
        : parseAttempt(existing).items.reduce(
            (total, item) => total + item.messageIds.length,
            0
          );
    let retainedPlanCount = 0;
    if (existing !== undefined) {
      const retainedPlan = mailUndoPlanSchema.safeParse(existing.plan);
      if (retainedPlan.success) {
        retainedPlanCount = retainedPlan.data.effects.length;
        if (
          retainedPlan.data.kind === "snooze" &&
          retainedPlan.data.restoration.kind === "restore"
        ) {
          retainedPlanCount =
            retainedPlan.data.restoration.schedule.hiddenMessageIds.length;
        }
      }
    }
    sourceCount += Math.max(resolvedCount, replayCount, retainedPlanCount);
    if (sourceCount > 1000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose at most 1,000 messages to undo at once.",
      });
    }
  }
  const admissions: MailUndoAdmission[] = [];
  for (const receiptId of input.receipts) {
    const existing = attempts.get(receiptId);
    const original = originals.get(receiptId) ?? null;
    let result = admitMailUndo(
      mailUndoAdmissionSchema.parse({
        actorUserId: current.actorUserId,
        attemptId: existing?.id ?? randomUUID(),
        authority:
          existing?.liveActorUserId === null
            ? { ...current, canWrite: false }
            : current,
        existingAttempt: existing === undefined ? null : parseAttempt(existing),
        mailboxId: current.mailboxId,
        now: now.toISOString(),
        original,
        receiptId,
      })
    );
    if (result.kind === "accepted") {
      const { attempt } = result;
      const [inserted] = await database
        .insert(mailUndoAttempt)
        .values({
          actorUserId: attempt.actorUserId,
          admittedAt: new Date(attempt.admittedAt),
          createdAt: now,
          cutoff: new Date(attempt.cutoff),
          id: attempt.id,
          items: attempt.items,
          liveActorUserId: attempt.actorUserId,
          liveMessageOperationId:
            attempt.originalKind === "message"
              ? attempt.originalOperationId
              : null,
          livePlacementOperationId:
            attempt.originalKind === "placement"
              ? attempt.originalOperationId
              : null,
          liveSnoozeOperationId:
            attempt.originalKind === "snooze"
              ? attempt.originalOperationId
              : null,
          mailboxId: attempt.mailboxId,
          originalKind: attempt.originalKind,
          originalOperationId: attempt.originalOperationId,
          state: attempt.state,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            mailUndoAttempt.originalKind,
            mailUndoAttempt.originalOperationId,
          ],
        })
        .returning();
      if (inserted === undefined) {
        const [retained] = await database
          .select()
          .from(mailUndoAttempt)
          .where(
            and(
              eq(mailUndoAttempt.actorUserId, current.actorUserId),
              eq(mailUndoAttempt.mailboxId, current.mailboxId),
              eq(mailUndoAttempt.originalKind, attempt.originalKind),
              eq(
                mailUndoAttempt.originalOperationId,
                attempt.originalOperationId
              )
            )
          )
          .for("update");
        if (retained === undefined) {
          throw new ORPCError("CONFLICT", {
            message: "The retained Undo attempt is no longer available.",
          });
        }
        result = admitMailUndo(
          mailUndoAdmissionSchema.parse({
            actorUserId: current.actorUserId,
            attemptId: retained.id,
            authority:
              retained.liveActorUserId === null
                ? { ...current, canWrite: false }
                : current,
            existingAttempt: parseAttempt(retained),
            mailboxId: current.mailboxId,
            now: now.toISOString(),
            original,
            receiptId,
          })
        );
      }
    }
    admissions.push({ original, receiptId, result });
  }
  return admissions;
};

const readExecution = async ({
  authority,
  database,
  attemptId,
}: StateInput & { attemptId: string }): Promise<MailUndoExecution> => {
  const [row] = await database
    .select()
    .from(mailUndoAttempt)
    .where(
      and(
        eq(mailUndoAttempt.id, z.uuid().parse(attemptId)),
        eq(mailUndoAttempt.actorUserId, authority.actorUserId),
        eq(mailUndoAttempt.mailboxId, authority.mailboxId)
      )
    )
    .for("update");
  if (row === undefined || row.liveActorUserId === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "This Undo action is no longer available.",
    });
  }
  const attempt = parseAttempt(row);
  if (attempt.liveOriginalOperationId === null) {
    throw new ORPCError("CONFLICT", {
      message: "The original action is no longer available.",
    });
  }
  const receiptId = mailUndoReceiptIdSchema.parse(
    `${row.originalKind}:${row.originalOperationId}`
  );
  const native = await readOriginalRow({ authority, database, receiptId });
  const original =
    native === null ? null : parseOriginal(native, native.row.undoProof);
  if (original === null) {
    throw new ORPCError("CONFLICT", {
      message: "The original action no longer has confirmed evidence.",
    });
  }
  return mailUndoExecutionSchema.parse({
    attempt,
    original,
    plan: row.plan,
    progress: row.progress,
  });
};

export const loadMailUndoExecution = async (
  input: StateInput & { attemptId: string }
): Promise<MailUndoExecution> => {
  const authority = await lockMailbox(input);
  return await readExecution({ ...input, authority });
};

export const captureMailUndoExecution = async ({
  authority,
  database,
  attemptId,
  items,
  plan: candidate,
}: StateInput & {
  attemptId: string;
  items: MailUndoAttempt["items"];
  plan: MailUndoPlan;
}): Promise<MailUndoExecution> => {
  const current = await lockMailbox({ authority, database });
  const [row] = await database
    .select()
    .from(mailUndoAttempt)
    .where(
      and(
        eq(mailUndoAttempt.id, z.uuid().parse(attemptId)),
        eq(mailUndoAttempt.actorUserId, current.actorUserId),
        eq(mailUndoAttempt.mailboxId, current.mailboxId)
      )
    )
    .for("update");
  if (row === undefined || row.liveActorUserId === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "This Undo action is no longer available.",
    });
  }
  if (row.plan !== null || row.progress !== null) {
    return await readExecution({ attemptId, authority: current, database });
  }
  const attempt = parseAttempt(row);
  const native = await readOriginalRow({
    authority: current,
    database,
    receiptId: mailUndoReceiptIdSchema.parse(
      `${row.originalKind}:${row.originalOperationId}`
    ),
  });
  const original =
    native === null ? null : parseOriginal(native, native.row.undoProof);
  if (original === null || attempt.liveOriginalOperationId === null) {
    throw new ORPCError("CONFLICT", {
      message: "The original action no longer has confirmed evidence.",
    });
  }
  const plan = mailUndoPlanSchema.parse(candidate);
  const capturedAttempt = mailUndoAttemptSchema.parse({ ...attempt, items });
  const progress = createMailUndoProgress({
    attempt: capturedAttempt,
    items,
    original,
    plan,
  });
  const execution = mailUndoExecutionSchema.parse({
    attempt: capturedAttempt,
    original,
    plan,
    progress,
  });
  await database
    .update(mailUndoAttempt)
    .set({
      items: capturedAttempt.items,
      plan,
      progress,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailUndoAttempt.id, attempt.id),
        eq(mailUndoAttempt.actorUserId, current.actorUserId),
        eq(mailUndoAttempt.mailboxId, current.mailboxId)
      )
    );
  return execution;
};

export const finishMailUndoWithoutEffects = async ({
  authority,
  database,
  attemptId,
  items,
}: StateInput & {
  attemptId: string;
  items: MailUndoAttempt["items"];
}): Promise<MailUndoAttempt> => {
  const current = await lockMailbox({ authority, database });
  const [row] = await database
    .select()
    .from(mailUndoAttempt)
    .where(
      and(
        eq(mailUndoAttempt.id, z.uuid().parse(attemptId)),
        eq(mailUndoAttempt.actorUserId, current.actorUserId),
        eq(mailUndoAttempt.mailboxId, current.mailboxId)
      )
    )
    .for("update");
  if (row === undefined || row.liveActorUserId === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "This Undo action is no longer available.",
    });
  }
  const attempt = parseAttempt(row);
  if (attempt.state === "completed") {
    return attempt;
  }
  if (
    row.plan !== null ||
    row.progress !== null ||
    attempt.state !== "accepted" ||
    items.some(
      (item) => item.status === "pending" || item.status === "compensated"
    )
  ) {
    throw new ORPCError("CONFLICT", {
      message: "This action already has a retained native phase.",
    });
  }
  const completed = mailUndoAttemptSchema.parse({
    ...attempt,
    items,
    state: "completed",
  });
  const native = await readOriginalRow({
    authority: current,
    database,
    receiptId: mailUndoReceiptIdSchema.parse(
      `${attempt.originalKind}:${attempt.originalOperationId}`
    ),
  });
  const original =
    native === null ? null : parseOriginal(native, native.row.undoProof);
  if (original?.proof) {
    const sourceIds =
      "effects" in original.proof
        ? original.proof.effects.map((effect) => effect.messageId)
        : [];
    if (
      completed.items.some(
        (item) =>
          (item.threadId !== null && item.threadId !== original.threadId) ||
          item.messageIds.some((id) => !sourceIds.includes(id))
      )
    ) {
      throw new ORPCError("CONFLICT", {
        message: "This result does not belong to the original action.",
      });
    }
  } else if (
    completed.items.some(
      (item) => item.threadId !== null || item.messageIds.length > 0
    )
  ) {
    throw new ORPCError("CONFLICT", {
      message: "This action no longer has matching source evidence.",
    });
  }
  await database
    .update(mailUndoAttempt)
    .set({
      items: completed.items,
      state: completed.state,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailUndoAttempt.id, attempt.id),
        eq(mailUndoAttempt.actorUserId, current.actorUserId),
        eq(mailUndoAttempt.mailboxId, current.mailboxId)
      )
    );
  return completed;
};

export const transitionMailUndoState = async ({
  authority,
  database,
  attemptId,
  event: candidate,
}: StateInput & {
  attemptId: string;
  event: ProgressEvent;
}): Promise<MailUndoExecution> => {
  const current = await lockMailbox({ authority, database });
  const execution = await readExecution({
    attemptId,
    authority: current,
    database,
  });
  const event = mailUndoProgressEventSchema.parse(candidate);
  if (event.kind === "link" || event.kind === "acknowledge") {
    if (execution.progress.kind !== "effects") {
      throw new ORPCError("CONFLICT", {
        message: "This action has no native effect phase.",
      });
    }
    const phase = execution.progress.phases.find(
      (item) => item.id === event.phaseId
    );
    const receipt =
      event.kind === "link" ? event.receipt : event.acknowledgement.receipt;
    if (phase === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "This action has no matching retained phase.",
      });
    }
    const native = await readOriginalRow({
      authority: current,
      database,
      receiptId: mailUndoReceiptIdSchema.parse(
        `${phase.owner}:${receipt.operationId}`
      ),
    });
    const association = mailUndoNativeAssociationSchema.safeParse(
      native?.row.undoProof
    );
    if (
      native === null ||
      native.kind === "snooze" ||
      !association.success ||
      association.data.attemptId !== attemptId ||
      association.data.phaseId !== phase.id ||
      native.row.requestId !== phase.requestId ||
      native.row.threadId !== execution.original.threadId ||
      native.row.createdAt.getTime() <
        Date.parse(execution.attempt.admittedAt) ||
      (event.kind === "link" &&
        native.row.status !== "pending" &&
        phase.native === null) ||
      (event.kind === "acknowledge" && native.row.status !== "applied") ||
      (event.kind === "acknowledge" &&
        event.acknowledgement.owner === "placement" &&
        (native.kind !== "placement" ||
          native.row.sequence !== event.acknowledgement.receipt.sequence ||
          native.row.placement !== event.acknowledgement.receipt.placement))
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "This native receipt does not belong to the retained Undo phase.",
      });
    }
    const requested =
      native.kind === "placement"
        ? native.row.requestedMessageIds
        : native.row.messageIds;
    const parsedRequested = sourceIdsSchema.safeParse(requested);
    const requestedByEvent =
      event.kind === "link"
        ? event.receipt.requestedMessageIds
        : event.acknowledgement.requestedMessageIds;
    if (
      !parsedRequested.success ||
      parsedRequested.data.length !== requestedByEvent.length ||
      parsedRequested.data.some((id) => !requestedByEvent.includes(id))
    ) {
      throw new ORPCError("CONFLICT", {
        message: "This native receipt has different retained targets.",
      });
    }
    let command: z.infer<typeof nativeCommandSchema> | null = null;
    if (event.kind === "link") {
      ({ command } = event.receipt);
    } else if (event.acknowledgement.owner === "message") {
      ({ command } = event.acknowledgement);
    }
    let placement: string | null = null;
    if (command?.facet === "destination") {
      placement =
        command.destination.kind === "managed"
          ? command.destination.value
          : null;
      if (command.destination.kind === "gmail") {
        placement = command.destination.inbox ? "inbox" : "done";
      }
    }
    if (
      (native.kind === "placement" &&
        command !== null &&
        placement !== native.row.placement) ||
      (native.kind === "message" &&
        JSON.stringify(nativeCommandSchema.parse(native.row.command)) !==
          JSON.stringify(command))
    ) {
      throw new ORPCError("CONFLICT", {
        message: "This native receipt has a different retained command.",
      });
    }
    if (event.kind === "acknowledge") {
      const acknowledged = sourceIdsSchema.safeParse(native.row.messageIds);
      if (
        !acknowledged.success ||
        acknowledged.data.length !==
          event.acknowledgement.acknowledgedMessageIds.length ||
        acknowledged.data.some(
          (id) => !event.acknowledgement.acknowledgedMessageIds.includes(id)
        )
      ) {
        throw new ORPCError("CONFLICT", {
          message: "This native receipt has different confirmed targets.",
        });
      }
    }
  }
  const progress = transitionMailUndoProgress({ event, execution });
  const projection = projectMailUndoProgress({
    execution: { ...execution, progress },
    replayed: false,
    waitingStatus:
      execution.attempt.state === "uncertain" ? "uncertain" : "pending",
  });
  const result = mailUndoExecutionSchema.parse({
    ...execution,
    attempt: { ...execution.attempt, ...projection },
    progress,
  });
  await database
    .update(mailUndoAttempt)
    .set({
      items: projection.items,
      progress,
      state: projection.state,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailUndoAttempt.id, attemptId),
        eq(mailUndoAttempt.actorUserId, current.actorUserId),
        eq(mailUndoAttempt.mailboxId, current.mailboxId)
      )
    );
  return result;
};
