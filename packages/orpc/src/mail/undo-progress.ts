import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { mailUndoItemSchema } from "@quieter/mail/undo";
import type { MailUndoItem } from "@quieter/mail/undo";
import { z } from "zod";

import {
  getMailUndoReceipt,
  mailUndoAttemptSchema,
  mailUndoNativePlacementSchema,
  mailUndoOriginalSchema,
  mailUndoPlanningSchema,
  mailUndoPlanSchema,
} from "./undo-model";
import type { MailUndoPlan } from "./undo-model";

const sourceIdSchema = mailUndoNativePlacementSchema.shape.mailboxId;
const revisionSchema = mailUndoNativePlacementSchema.shape.sequence;
const [readInverseSchema, destinationInverseSchema] =
  mailUndoPlanSchema.options[0].shape.effects.element.options;
const commandSchema = z.discriminatedUnion("facet", [
  readInverseSchema.pick({ facet: true, read: true }),
  destinationInverseSchema.pick({ destination: true, facet: true }),
]);
type Command = z.infer<typeof commandSchema>;
const messageIdsSchema = z
  .array(sourceIdSchema)
  .min(1)
  .max(1000)
  .refine((ids) => new Set(ids).size === ids.length, "Repeated source.");
const nativeReferenceSchema = z.strictObject({
  actorUserId: sourceIdSchema,
  mailboxId: sourceIdSchema,
  operationId: z.uuid(),
  owner: z.enum(["placement", "message"]),
  requestId: z.uuid(),
  threadId: sourceIdSchema,
});
const linkedReceiptSchema = nativeReferenceSchema.extend({
  command: commandSchema,
  requestedMessageIds: messageIdsSchema,
});
const acknowledgementSchema = z.discriminatedUnion("owner", [
  z.strictObject({
    acknowledgedAt: z.iso.datetime({ offset: true }),
    acknowledgedMessageIds: messageIdsSchema,
    owner: z.literal("placement"),
    receipt: mailUndoNativePlacementSchema.extend({
      status: z.literal("applied"),
    }),
    requestedMessageIds: messageIdsSchema,
    status: z.literal("acknowledged"),
  }),
  z.strictObject({
    acknowledgedAt: z.iso.datetime({ offset: true }),
    acknowledgedMessageIds: messageIdsSchema,
    command: commandSchema,
    owner: z.literal("message"),
    receipt: nativeReferenceSchema.extend({ owner: z.literal("message") }),
    requestedMessageIds: messageIdsSchema,
    status: z.literal("acknowledged"),
  }),
]);
const failureSchema = mailUndoItemSchema.options[1]
  .pick({ code: true, message: true, status: true })
  .extend({
    status: z.enum(["expired", "denied", "changed", "failed", "uncertain"]),
  });
const phaseFields = {
  effectIndexes: z
    .array(z.int().min(0).max(999))
    .min(1)
    .max(1000)
    .refine((indexes) => new Set(indexes).size === indexes.length),
  id: z.uuid(),
  intentToken: z.uuid(),
  owner: z.enum(["placement", "message"]),
  requestId: z.uuid(),
};
const phaseSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...phaseFields,
    native: nativeReferenceSchema.nullable(),
    state: z.literal("waiting"),
  }),
  z.strictObject({
    ...phaseFields,
    acknowledgement: acknowledgementSchema,
    native: nativeReferenceSchema,
    state: z.literal("acknowledged"),
  }),
  z.strictObject({
    ...phaseFields,
    failure: failureSchema,
    native: nativeReferenceSchema.nullable(),
    state: z.literal("stopped"),
  }),
]);
const scopeSchema = z.strictObject({
  actorUserId: sourceIdSchema,
  attemptId: z.uuid(),
  mailboxId: sourceIdSchema,
  originalKind: mailUndoAttemptSchema.shape.originalKind,
  originalOperationId: z.uuid(),
  threadId: sourceIdSchema,
});
const scheduleOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("waiting") }),
  z.strictObject({ state: z.literal("acknowledged"), version: revisionSchema }),
  z.strictObject({ failure: failureSchema, state: z.literal("stopped") }),
]);

const retainedItemSchema = z.union([
  mailUndoItemSchema.options[0].extend({ status: z.literal("unchanged") }),
  mailUndoItemSchema.options[1].extend({
    status: z.enum(["expired", "denied", "changed", "failed", "uncertain"]),
  }),
]);
const retainedItemsSchema = z.array(retainedItemSchema).max(1000);

export const mailUndoProgressSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("effects"),
    phases: z.array(phaseSchema).min(1).max(1000),
    retainedItems: retainedItemsSchema,
    scope: scopeSchema,
  }),
  z.strictObject({
    kind: z.literal("schedule"),
    outcome: scheduleOutcomeSchema,
    retainedItems: retainedItemsSchema,
    scope: scopeSchema,
  }),
]);
export type MailUndoProgress = z.infer<typeof mailUndoProgressSchema>;

const resolvePhaseCommand = (
  plan: MailUndoPlan,
  indexes: number[]
): Command | null => {
  let command: Command | null = null;
  for (const index of indexes) {
    const effect = plan.effects[index];
    if (effect === undefined) {
      return null;
    }
    const next =
      effect.facet === "read"
        ? { facet: effect.facet, read: effect.read }
        : { destination: effect.destination, facet: effect.facet };
    if (command !== null && !isDeepStrictEqual(command, next)) {
      return null;
    }
    command = next;
  }
  if (plan.kind !== "message") {
    if (command?.facet !== "destination") {
      return null;
    }
    const { destination } = command;
    if (
      (destination.kind === "managed" &&
        !["inbox", "done"].includes(destination.value)) ||
      (destination.kind === "gmail" && (destination.spam || destination.trash))
    ) {
      return null;
    }
  }
  return command;
};

export const mailUndoExecutionSchema = z
  .strictObject({
    attempt: mailUndoAttemptSchema,
    original: mailUndoOriginalSchema,
    plan: mailUndoPlanSchema,
    progress: mailUndoProgressSchema,
  })
  .transform((execution, context) => {
    const { attempt, original, plan, progress } = execution;
    const { scope } = progress;
    if (
      scope.actorUserId !== attempt.actorUserId ||
      scope.attemptId !== attempt.id ||
      scope.mailboxId !== attempt.mailboxId ||
      scope.originalKind !== attempt.originalKind ||
      scope.originalOperationId !== attempt.originalOperationId ||
      scope.actorUserId !== original.actorUserId ||
      scope.mailboxId !== original.mailboxId ||
      scope.threadId !== original.threadId ||
      scope.originalKind !== original.kind ||
      scope.originalOperationId !== original.operationId ||
      attempt.cutoff !== original.cutoff ||
      Date.parse(attempt.admittedAt) < Date.parse(original.admittedAt) ||
      plan.kind !== original.kind ||
      original.proof === null ||
      getMailUndoReceipt({ now: attempt.admittedAt, original }) === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid retained Undo progress.",
      });
      return execution;
    }
    const originalEffects =
      "effects" in original.proof ? original.proof.effects : [];
    const plannedIds = new Set(plan.effects.map((effect) => effect.messageId));
    const omittedIds = new Set(
      originalEffects
        .filter((effect) => !plannedIds.has(effect.messageId))
        .map((effect) => effect.messageId)
    );
    const retainedIds = progress.retainedItems.flatMap(
      (item) => item.messageIds
    );
    const receiptId = `${scope.originalKind}:${scope.originalOperationId}`;
    if (
      retainedIds.length !== omittedIds.size ||
      new Set(retainedIds).size !== retainedIds.length ||
      retainedIds.some((id) => !omittedIds.has(id)) ||
      retainedIds.length + plan.effects.length > 1000 ||
      progress.retainedItems.some(
        (item) =>
          item.receiptId !== receiptId ||
          item.threadId !== scope.threadId ||
          item.replayed ||
          item.messageIds.length === 0
      ) ||
      (attempt.state === "completed" &&
        progress.retainedItems.some((item) => item.status === "uncertain"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid retained Undo outcomes.",
      });
    }
    for (const effect of plan.effects) {
      const before = originalEffects.find(
        (candidate) =>
          candidate.messageId === effect.messageId &&
          candidate.facet === effect.facet
      );
      if (
        before === undefined ||
        before.outcome.status !== "acknowledged" ||
        isDeepStrictEqual(before.before, before.after) ||
        before.intentToken !== effect.expectedIntentToken ||
        !isDeepStrictEqual(before.outcome.proof, effect.sourceProof) ||
        (before.facet === "read" &&
          (effect.facet !== "read" || before.before !== effect.read)) ||
        (before.facet === "destination" &&
          (effect.facet !== "destination" ||
            !isDeepStrictEqual(before.before, effect.destination)))
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid retained Undo progress.",
        });
      }
    }
    if (
      new Set(plan.effects.map((effect) => effect.messageId)).size !==
        plan.effects.length ||
      (original.kind === "placement" &&
        original.proof !== null &&
        (plan.kind !== "placement" ||
          plan.expectedSequence !== original.proof.acceptedSequence))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid retained Undo progress.",
      });
    }
    if (original.kind === "snooze" && original.proof !== null) {
      const { proof } = original;
      const restorationKinds = {
        cancel: "restore",
        reschedule: "restore",
        "return-now": "rehide",
        snooze: "retire",
      };
      if (
        plan.kind !== "snooze" ||
        plan.scope.actorUserId !== scope.actorUserId ||
        plan.scope.attemptId !== scope.attemptId ||
        plan.scope.mailboxId !== scope.mailboxId ||
        plan.scope.threadId !== scope.threadId ||
        plan.scheduleId !== proof.after.id ||
        plan.expectedVersion !== proof.after.version ||
        !isDeepStrictEqual(
          plan.expectedPlacement,
          proof.placementPredecessor
        ) ||
        plan.restoration.kind !== restorationKinds[proof.command]
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid retained Undo progress.",
        });
      } else if ("previous" in proof) {
        const { version: _version, ...previous } = proof.previous;
        if (
          (plan.restoration.kind === "restore" &&
            !isDeepStrictEqual(plan.restoration.schedule, previous)) ||
          (plan.restoration.kind === "rehide" &&
            (plan.restoration.predecessorHideOperationId !==
              previous.hideOperationId ||
              !isDeepStrictEqual(plan.restoration.template, {
                hiddenMessageIds: previous.hiddenMessageIds,
                id: previous.id,
                knownIncomingMessageIds: previous.knownIncomingMessageIds,
                returnAt: previous.returnAt,
                status: previous.status,
                timeZone: previous.timeZone,
              })))
        ) {
          context.addIssue({
            code: "custom",
            message: "Invalid retained Undo progress.",
          });
        }
      }
    }
    if (progress.kind === "schedule") {
      if (
        plan.kind !== "snooze" ||
        plan.restoration.kind !== "restore" ||
        plan.effects.length !== 0 ||
        (attempt.state === "completed" &&
          (progress.outcome.state === "waiting" ||
            (progress.outcome.state === "stopped" &&
              progress.outcome.failure.status === "uncertain"))) ||
        (progress.outcome.state === "acknowledged" &&
          progress.outcome.version !== plan.nextVersion)
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid retained Undo progress.",
        });
      }
      return execution;
    }
    const indexes = progress.phases.flatMap((phase) => phase.effectIndexes);
    const nativeIds = progress.phases.flatMap((phase) =>
      phase.native === null ? [] : [phase.native.operationId]
    );
    if (
      indexes.length !== plan.effects.length ||
      (plan.kind !== "message" && progress.phases.length !== 1) ||
      (attempt.state === "completed" &&
        progress.phases.some(
          (phase) =>
            phase.state === "waiting" ||
            (phase.state === "stopped" && phase.failure.status === "uncertain")
        )) ||
      new Set(indexes).size !== indexes.length ||
      indexes.some((index) => plan.effects[index] === undefined) ||
      new Set(progress.phases.map((phase) => phase.id)).size !==
        progress.phases.length ||
      new Set(progress.phases.map((phase) => phase.requestId)).size !==
        progress.phases.length ||
      new Set(progress.phases.map((phase) => phase.intentToken)).size !==
        progress.phases.length ||
      new Set(nativeIds).size !== nativeIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid retained Undo progress.",
      });
    }
    for (const phase of progress.phases) {
      if (
        phase.owner !== (plan.kind === "message" ? "message" : "placement") ||
        resolvePhaseCommand(plan, phase.effectIndexes) === null ||
        phase.effectIndexes.some(
          (index) =>
            plan.effects[index]?.expectedIntentToken === phase.intentToken
        ) ||
        (phase.native !== null &&
          (phase.native.owner !== phase.owner ||
            phase.native.requestId !== phase.requestId ||
            phase.native.actorUserId !== scope.actorUserId ||
            phase.native.mailboxId !== scope.mailboxId ||
            phase.native.threadId !== scope.threadId ||
            phase.native.operationId === scope.originalOperationId ||
            phase.native.operationId === scope.attemptId ||
            phase.native.operationId === phase.id ||
            phase.native.operationId === phase.requestId ||
            (plan.kind === "snooze" &&
              (phase.native.operationId ===
                plan.expectedPlacement.operationId ||
                (plan.restoration.kind === "rehide" &&
                  phase.native.operationId ===
                    plan.restoration.predecessorHideOperationId)))))
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid retained Undo progress.",
        });
      }
      if (phase.state === "acknowledged") {
        const ack = phase.acknowledgement;
        const command = resolvePhaseCommand(plan, phase.effectIndexes);
        const ids = phase.effectIndexes.map(
          (index) => plan.effects[index]?.messageId
        );
        let placement: string | null = null;
        if (command?.facet === "destination") {
          if (command.destination.kind === "managed") {
            placement = command.destination.value;
          } else {
            placement = command.destination.inbox ? "inbox" : "done";
          }
        }
        if (
          ack.owner !== phase.owner ||
          ack.receipt.operationId !== phase.native.operationId ||
          ack.receipt.requestId !== phase.native.requestId ||
          ack.receipt.actorUserId !== phase.native.actorUserId ||
          ack.receipt.mailboxId !== phase.native.mailboxId ||
          ack.receipt.threadId !== phase.native.threadId ||
          Date.parse(ack.acknowledgedAt) < Date.parse(attempt.admittedAt) ||
          ack.requestedMessageIds.length !== ids.length ||
          ack.requestedMessageIds.some((id) => !ids.includes(id)) ||
          ack.acknowledgedMessageIds.length !== ids.length ||
          ack.acknowledgedMessageIds.some((id) => !ids.includes(id)) ||
          (ack.owner === "message" &&
            !isDeepStrictEqual(ack.command, command)) ||
          (ack.owner === "placement" &&
            (command?.facet !== "destination" ||
              ack.receipt.placement !== placement ||
              (plan.kind !== "message" &&
                BigInt(ack.receipt.sequence) <=
                  BigInt(
                    plan.kind === "placement"
                      ? plan.expectedSequence
                      : plan.expectedPlacement.sequence
                  ))))
        ) {
          context.addIssue({
            code: "custom",
            message: "Invalid retained Undo progress.",
          });
        }
      }
    }
    return execution;
  });
export type MailUndoExecution = z.infer<typeof mailUndoExecutionSchema>;

export const mailUndoProgressEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("link"),
    phaseId: z.uuid(),
    receipt: linkedReceiptSchema,
  }),
  z.strictObject({
    acknowledgement: acknowledgementSchema,
    kind: z.literal("acknowledge"),
    phaseId: z.uuid(),
  }),
  z.strictObject({
    failure: failureSchema,
    kind: z.literal("stop"),
    phaseId: z.uuid(),
  }),
  z.strictObject({
    actorUserId: sourceIdSchema,
    kind: z.literal("complete-schedule"),
    mailboxId: sourceIdSchema,
    schedule:
      mailUndoPlanningSchema.shape.currentSchedule.unwrap().shape.schedule,
    threadId: sourceIdSchema,
  }),
  z.strictObject({ failure: failureSchema, kind: z.literal("stop-schedule") }),
]);

export const createMailUndoProgress = (
  input: Omit<MailUndoExecution, "progress"> & { items: MailUndoItem[] }
): MailUndoProgress => {
  const { items: candidateItems, ...execution } = input;
  const { attempt, original, plan } = execution;
  const items = z.array(mailUndoItemSchema).max(1000).parse(candidateItems);
  const retainedItems = retainedItemsSchema.parse(
    items.filter((item) => item.status !== "pending")
  );
  const pendingItems = items.filter((item) => item.status === "pending");
  const pendingIds = pendingItems.flatMap((item) => item.messageIds);
  const plannedIds = new Set(plan.effects.map((effect) => effect.messageId));
  const scheduleOnly =
    plan.kind === "snooze" && plan.restoration.kind === "restore";
  if (
    items.some(
      (item) =>
        item.receiptId !== `${original.kind}:${original.operationId}` ||
        item.threadId !== original.threadId ||
        item.replayed
    ) ||
    pendingIds.length !== plan.effects.length ||
    new Set(pendingIds).size !== pendingIds.length ||
    pendingIds.some((id) => !plannedIds.has(id)) ||
    (scheduleOnly
      ? pendingItems.length !== 1 || pendingIds.length !== 0
      : pendingItems.some((item) => item.messageIds.length === 0))
  ) {
    throw new Error("Planner outcomes do not belong to this inverse.");
  }
  if (
    attempt.state !== "accepted" ||
    attempt.liveOriginalOperationId === null
  ) {
    throw new Error("Only a live accepted inverse can capture progress.");
  }
  const scope = {
    actorUserId: attempt.actorUserId,
    attemptId: attempt.id,
    mailboxId: attempt.mailboxId,
    originalKind: attempt.originalKind,
    originalOperationId: attempt.originalOperationId,
    threadId: original.threadId,
  };
  if (plan.kind === "snooze" && plan.restoration.kind === "restore") {
    return mailUndoExecutionSchema.parse({
      ...execution,
      progress: {
        kind: "schedule",
        outcome: { state: "waiting" },
        retainedItems,
        scope,
      },
    }).progress;
  }
  const groups = new Map<string, number[]>();
  for (let index = 0; index < plan.effects.length; index += 1) {
    const effect = plan.effects[index];
    const command = resolvePhaseCommand(plan, [index]);
    if (command === null) {
      throw new Error("An inverse phase needs a supported command.");
    }
    const key = `${JSON.stringify(command)}:${plan.kind === "message" && effect.sourceProof.kind === "gmail-acknowledged-snapshot" ? index : "atomic"}`;
    const indexes = groups.get(key);
    if (indexes === undefined) {
      groups.set(key, [index]);
    } else {
      indexes.push(index);
    }
  }
  return mailUndoExecutionSchema.parse({
    ...execution,
    progress: {
      kind: "effects",
      phases: [...groups.values()].map((effectIndexes) => ({
        effectIndexes,
        id: randomUUID(),
        intentToken: randomUUID(),
        native: null,
        owner: plan.kind === "message" ? "message" : "placement",
        requestId: randomUUID(),
        state: "waiting",
      })),
      retainedItems,
      scope,
    },
  }).progress;
};

export const transitionMailUndoProgress = (input: {
  event: z.infer<typeof mailUndoProgressEventSchema>;
  execution: MailUndoExecution;
}): MailUndoProgress => {
  const execution = mailUndoExecutionSchema.parse(input.execution);
  const event = mailUndoProgressEventSchema.parse(input.event);
  const { attempt, plan, progress } = execution;
  if (progress.kind === "schedule") {
    let { outcome } = progress;
    if (
      event.kind === "complete-schedule" &&
      plan.kind === "snooze" &&
      plan.restoration.kind === "restore"
    ) {
      if (
        event.actorUserId !== progress.scope.actorUserId ||
        event.mailboxId !== progress.scope.mailboxId ||
        event.threadId !== progress.scope.threadId ||
        !isDeepStrictEqual(event.schedule, {
          ...plan.restoration.schedule,
          version: plan.nextVersion,
        }) ||
        outcome.state === "stopped"
      ) {
        throw new Error(
          "The committed schedule does not belong to this inverse."
        );
      }
      outcome = { state: "acknowledged", version: plan.nextVersion };
    } else if (event.kind === "stop-schedule") {
      if (
        outcome.state === "acknowledged" ||
        (outcome.state === "stopped" &&
          !isDeepStrictEqual(outcome.failure, event.failure))
      ) {
        throw new Error("A settled inverse cannot change its outcome.");
      }
      outcome = { failure: event.failure, state: "stopped" };
    } else {
      throw new Error("A schedule-only inverse has no native phase.");
    }
    return mailUndoExecutionSchema.parse({
      ...execution,
      progress: { ...progress, outcome },
    }).progress;
  }
  if (!("phaseId" in event)) {
    throw new Error("A native inverse requires its retained phase.");
  }
  const phase = progress.phases.find(
    (candidate) => candidate.id === event.phaseId
  );
  if (phase === undefined) {
    throw new Error("The inverse phase is unavailable.");
  }
  let next = phase;
  if (event.kind === "link") {
    const { command, requestedMessageIds, ...native } = event.receipt;
    const ids = phase.effectIndexes.map(
      (index) => plan.effects[index]?.messageId
    );
    if (
      phase.state !== "waiting" ||
      attempt.liveOriginalOperationId === null ||
      !isDeepStrictEqual(
        command,
        resolvePhaseCommand(plan, phase.effectIndexes)
      ) ||
      requestedMessageIds.length !== ids.length ||
      requestedMessageIds.some((id) => !ids.includes(id)) ||
      (phase.native !== null && !isDeepStrictEqual(phase.native, native))
    ) {
      throw new Error("The native receipt does not belong to this phase.");
    }
    next = { ...phase, native };
  } else if (event.kind === "acknowledge") {
    if (
      phase.native === null ||
      phase.state === "stopped" ||
      (phase.state === "acknowledged" &&
        !isDeepStrictEqual(phase.acknowledgement, event.acknowledgement))
    ) {
      throw new Error("Only the linked phase can acknowledge its result.");
    }
    next = {
      ...phase,
      acknowledgement: event.acknowledgement,
      native: phase.native,
      state: "acknowledged",
    };
  } else if (event.kind === "stop") {
    if (
      phase.state === "acknowledged" ||
      (phase.state === "stopped" &&
        !isDeepStrictEqual(phase.failure, event.failure))
    ) {
      throw new Error("A settled inverse cannot change its outcome.");
    }
    next = { ...phase, failure: event.failure, state: "stopped" };
  }
  return mailUndoExecutionSchema.parse({
    ...execution,
    progress: {
      ...progress,
      phases: progress.phases.map((candidate) =>
        candidate.id === phase.id ? next : candidate
      ),
    },
  }).progress;
};

export const projectMailUndoProgress = (input: {
  execution: MailUndoExecution;
  replayed: boolean;
  waitingStatus: "pending" | "uncertain";
}): Pick<MailUndoExecution["attempt"], "items" | "state"> => {
  const { progress, plan } = mailUndoExecutionSchema.parse(input.execution);
  const common = {
    receiptId: `${progress.scope.originalKind}:${progress.scope.originalOperationId}`,
    replayed: input.replayed,
    threadId: progress.scope.threadId,
  };
  const items: MailUndoItem[] = progress.retainedItems.map((item) => ({
    ...item,
    messageIds: [...item.messageIds],
    replayed: input.replayed,
  }));
  let waiting = false;
  let linked = false;
  const outcomes =
    progress.kind === "schedule"
      ? [{ messageIds: [], native: null, ...progress.outcome }]
      : progress.phases.map((phase) => ({
          ...phase,
          messageIds: phase.effectIndexes
            .map((index) => plan.effects[index]?.messageId)
            .filter((id) => id !== undefined),
        }));
  for (const outcome of outcomes) {
    linked ||= outcome.native !== null;
    if (outcome.state === "acknowledged") {
      items.push(
        mailUndoItemSchema.parse({
          ...common,
          messageIds: outcome.messageIds,
          status: "compensated",
        })
      );
    } else if (outcome.state === "stopped") {
      items.push(
        mailUndoItemSchema.parse({
          ...common,
          ...outcome.failure,
          messageIds: outcome.messageIds,
        })
      );
    } else {
      waiting = true;
      items.push(
        mailUndoItemSchema.parse({
          ...common,
          code:
            input.waitingStatus === "uncertain"
              ? "undo_unconfirmed"
              : "undo_pending",
          message:
            input.waitingStatus === "uncertain"
              ? "This action has not been confirmed. Refresh before trying again."
              : "Undo is ready to finish.",
          messageIds: outcome.messageIds,
          status: input.waitingStatus,
        })
      );
    }
  }
  let state: MailUndoExecution["attempt"]["state"] = "completed";
  if (
    (waiting && input.waitingStatus === "uncertain") ||
    items.some((item) => item.status === "uncertain")
  ) {
    state = "uncertain";
  } else if (waiting) {
    state = linked ? "submitting" : "accepted";
  }
  return { items, state };
};
