import type { DatabaseTransaction } from "@quieter/database/client";
import type { mailSnooze, mailSnoozeOperation } from "@quieter/database/schema";
import {
  mailMessageIntent,
  mailPlacementOperation,
  managedMailMessage,
} from "@quieter/database/schema";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { snoozePlacementAcknowledgementSchema } from "../mail/placement-undo-proof";
import {
  createMailUndoCutoff,
  mailUndoNativePlacementSchema,
  mailUndoOriginalSchema,
  mailUndoPlanningSchema,
} from "../mail/undo-model";
import { persistMailUndoOriginal } from "../mail/undo-state";

type SnoozeRow = typeof mailSnooze.$inferSelect;

export const recordManagedSnoozeUndoOriginal = async ({
  database,
  operation,
  previous,
  current,
}: {
  database: DatabaseTransaction;
  operation: typeof mailSnoozeOperation.$inferSelect;
  previous: SnoozeRow | null;
  current: SnoozeRow;
}): Promise<void> => {
  if (
    operation.status !== "applied" ||
    current.id !== operation.snoozeId ||
    current.mailboxId !== operation.mailboxId ||
    current.threadId !== operation.threadId ||
    current.version !== operation.resultingVersion
  ) {
    return;
  }
  const after = {
    hiddenMessageIds: current.hiddenMessageIds,
    hideOperationId: current.hideOperationId,
    id: current.id,
    knownIncomingMessageIds: current.knownIncomingMessageIds,
    returnAt: current.returnAt.toISOString(),
    status: current.status,
    timeZone: current.timeZone,
    version: current.version.toString(),
  };
  const checked = mailUndoPlanningSchema.shape.currentSchedule
    .unwrap()
    .shape.schedule.safeParse(after);
  if (!checked.success) {
    return;
  }
  const [native] = await database
    .select({
      ...getTableColumns(mailPlacementOperation),
      sequence: sql<string>`${mailPlacementOperation.sequence}::text`,
    })
    .from(mailPlacementOperation)
    .where(
      and(
        eq(mailPlacementOperation.mailboxId, current.mailboxId),
        eq(mailPlacementOperation.threadId, current.threadId)
      )
    )
    .orderBy(desc(mailPlacementOperation.sequence))
    .limit(1);
  const returning = operation.kind === "return-now";
  if (
    native === undefined ||
    native.status !== "applied" ||
    native.id !==
      (returning ? current.returnOperationId : current.hideOperationId) ||
    native.requestId !==
      (returning ? current.returnRequestId : current.hideRequestId)
  ) {
    return;
  }
  const placementPredecessor = mailUndoNativePlacementSchema.parse({
    actorUserId: native.actorUserId,
    mailboxId: native.mailboxId,
    operationId: native.id,
    placement: native.placement,
    requestId: native.requestId,
    sequence: native.sequence,
    status: native.status,
    threadId: native.threadId,
  });
  const saved =
    previous === null
      ? null
      : {
          hiddenMessageIds: previous.hiddenMessageIds,
          hideOperationId: previous.hideOperationId,
          id: previous.id,
          knownIncomingMessageIds: previous.knownIncomingMessageIds,
          returnAt: previous.returnAt.toISOString(),
          status: previous.status,
          timeZone: previous.timeZone,
          version: previous.version.toString(),
        };
  let proof: unknown;
  if (operation.kind === "snooze" || returning) {
    const acknowledgement = snoozePlacementAcknowledgementSchema.safeParse(
      native.undoProof
    );
    if (
      !acknowledgement.success ||
      acknowledgement.data.original.kind !== "placement" ||
      acknowledgement.data.original.proof === null ||
      acknowledgement.data.original.operationId !== native.id ||
      acknowledgement.data.original.actorUserId !== operation.actorUserId ||
      acknowledgement.data.original.mailboxId !== current.mailboxId ||
      acknowledgement.data.original.threadId !== current.threadId ||
      acknowledgement.data.original.proof.acceptedSequence !== native.sequence
    ) {
      return;
    }
    proof = {
      after,
      command: operation.kind,
      completion: "acknowledged",
      effects: acknowledgement.data.original.proof.effects,
      placementPredecessor,
      ...(returning ? { previous: saved } : {}),
    };
  } else {
    if (saved === null) {
      return;
    }
    const messages = await database
      .select({
        destinationRevision: managedMailMessage.destinationRevision,
        id: managedMailMessage.id,
        mailboxState: managedMailMessage.mailboxState,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, current.mailboxId),
          eq(managedMailMessage.threadId, current.threadId),
          eq(managedMailMessage.direction, "inbound"),
          inArray(managedMailMessage.id, checked.data.hiddenMessageIds)
        )
      )
      .orderBy(asc(managedMailMessage.id))
      .for("update");
    if (
      messages.length !== checked.data.hiddenMessageIds.length ||
      messages.some((message) => message.mailboxState !== "done")
    ) {
      return;
    }
    const intents = await database
      .select()
      .from(mailMessageIntent)
      .where(
        and(
          eq(mailMessageIntent.mailboxId, current.mailboxId),
          inArray(mailMessageIntent.messageId, checked.data.hiddenMessageIds)
        )
      );
    proof = {
      after,
      command: operation.kind,
      completion: "acknowledged",
      guards: messages.map((message) => ({
        after: { kind: "managed", value: "done" },
        before: { kind: "managed", value: "done" },
        facet: "destination",
        intentToken:
          intents.find((intent) => intent.messageId === message.id)
            ?.destinationIntentToken ?? null,
        messageId: message.id,
        outcome: {
          proof: {
            kind: "managed-revision",
            revision: message.destinationRevision.toString(),
          },
          status: "acknowledged",
        },
        phaseId: native.id,
      })),
      placementPredecessor,
      previous: saved,
    };
  }
  const parsed = mailUndoOriginalSchema.safeParse({
    actorUserId: operation.actorUserId,
    admittedAt: operation.createdAt.toISOString(),
    cutoff: createMailUndoCutoff({
      admittedAt: operation.createdAt.toISOString(),
      previousReturnAt:
        operation.kind === "snooze" ? null : (saved?.returnAt ?? null),
    }),
    kind: "snooze",
    mailboxId: operation.mailboxId,
    operationId: operation.id,
    proof,
    threadId: operation.threadId,
  });
  if (parsed.success) {
    await persistMailUndoOriginal({
      authority: {
        actorUserId: operation.actorUserId,
        canWrite: true,
        mailboxId: operation.mailboxId,
      },
      database,
      original: parsed.data,
    });
  }
};
