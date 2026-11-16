import { reminderTimeZoneSchema } from "@quieter/mail/reminders";
import {
  mailUndoItemSchema,
  mailUndoReceiptIdSchema,
} from "@quieter/mail/undo";
import type { MailUndoItem, MailUndoReceipt } from "@quieter/mail/undo";
import { z } from "zod";

const sourceIdSchema = z.string().trim().min(1).max(255);
const instantSchema = z.iso.datetime({ offset: true });
const revisionSchema = z
  .string()
  .max(255)
  .regex(/^(?:0|[1-9]\d*)$/u);
const messageIdsSchema = z
  .array(sourceIdSchema)
  .max(1000)
  .refine((ids) => new Set(ids).size === ids.length, "Repeated message.");
const namedTimeZoneSchema = reminderTimeZoneSchema.refine(
  (zone) => !zone.startsWith("+") && !zone.startsWith("-")
);

const undoWindowMs = 15_000;

export const createMailUndoCutoff = (input: {
  admittedAt: string;
  previousReturnAt: string | null;
}): string => {
  const cutoff = Date.parse(input.admittedAt) + undoWindowMs;
  const deadline =
    input.previousReturnAt === null
      ? cutoff
      : Date.parse(input.previousReturnAt);
  return new Date(Math.min(cutoff, deadline)).toISOString();
};

const destinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("managed"),
    value: z.enum(["inbox", "done", "spam", "trash"]),
  }),
  z.strictObject({
    inbox: z.boolean(),
    kind: z.literal("gmail"),
    spam: z.boolean(),
    trash: z.boolean(),
  }),
]);
type Destination = z.infer<typeof destinationSchema>;

const sourceProofSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("managed-revision"),
    revision: revisionSchema,
  }),
  z
    .strictObject({
      acknowledgedAt: instantSchema,
      historyId: revisionSchema,
      kind: z.literal("gmail-acknowledged-snapshot"),
      snapshotAt: instantSchema,
    })
    .refine(
      (proof) =>
        Date.parse(proof.snapshotAt) >= Date.parse(proof.acknowledgedAt),
      "The source snapshot must follow the acknowledgement."
    ),
]);

const effectOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    proof: sourceProofSchema,
    status: z.literal("acknowledged"),
  }),
  z.strictObject({
    status: z.enum([
      "prepared",
      "submitting",
      "uncertain",
      "observed-applied",
      "failed",
      "unchanged",
    ]),
  }),
]);
const effectFields = {
  intentToken: z.uuid(),
  messageId: sourceIdSchema,
  outcome: effectOutcomeSchema,
  phaseId: z.uuid(),
};
const destinationEffectSchema = z.strictObject({
  ...effectFields,
  after: destinationSchema,
  before: destinationSchema,
  facet: z.literal("destination"),
});
const effectSchema = z.discriminatedUnion("facet", [
  z.strictObject({
    ...effectFields,
    after: z.boolean(),
    before: z.boolean(),
    facet: z.literal("read"),
  }),
  destinationEffectSchema,
]);
type Effect = z.infer<typeof effectSchema>;

const scheduleFields = {
  hiddenMessageIds: messageIdsSchema.min(1),
  hideOperationId: z.uuid(),
  id: z.uuid(),
  knownIncomingMessageIds: messageIdsSchema,
  returnAt: instantSchema,
  timeZone: namedTimeZoneSchema,
};
const previousScheduleSchema = z.strictObject({
  ...scheduleFields,
  status: z.enum(["active", "suspended"]),
  version: revisionSchema,
});
const restoredScheduleSchema = previousScheduleSchema.omit({ version: true });
const scheduleSchema = z.strictObject({
  ...scheduleFields,
  status: z.enum(["active", "suspended", "cancelled", "returned"]),
  version: revisionSchema,
});
const snoozeFields = {
  after: scheduleSchema,
  completion: z.enum([
    "acknowledged",
    "observed-applied",
    "submitting",
    "uncertain",
    "failed",
  ]),
};
const snoozeProofSchema = z.discriminatedUnion("command", [
  z.strictObject({
    ...snoozeFields,
    command: z.literal("snooze"),
    effects: z.array(destinationEffectSchema).max(1000),
  }),
  z.strictObject({
    ...snoozeFields,
    command: z.enum(["reschedule", "cancel"]),
    guards: z.array(destinationEffectSchema).max(1000),
    previous: previousScheduleSchema,
  }),
  z.strictObject({
    ...snoozeFields,
    command: z.literal("return-now"),
    effects: z.array(destinationEffectSchema).max(1000),
    previous: previousScheduleSchema,
  }),
]);
const originalFields = {
  actorUserId: sourceIdSchema,
  admittedAt: instantSchema,
  cutoff: instantSchema,
  mailboxId: sourceIdSchema,
  operationId: z.uuid(),
  threadId: sourceIdSchema,
};

const sameDestination = (left: Destination, right: Destination): boolean => {
  if (left.kind === "managed" && right.kind === "managed") {
    return left.value === right.value;
  }
  if (left.kind === "gmail" && right.kind === "gmail") {
    return (
      left.inbox === right.inbox &&
      left.spam === right.spam &&
      left.trash === right.trash
    );
  }
  return false;
};

const placementValue = (destination: Destination): "inbox" | "done" | null => {
  if (destination.kind === "managed") {
    return destination.value === "inbox" || destination.value === "done"
      ? destination.value
      : null;
  }
  if (destination.spam || destination.trash) {
    return null;
  }
  return destination.inbox ? "inbox" : "done";
};

const sameIds = (left: string[], right: string[]): boolean => {
  const rightIds = new Set(right);
  return left.length === right.length && left.every((id) => rightIds.has(id));
};

const effectChanged = (effect: Effect): boolean => {
  if (effect.facet === "read") {
    return effect.before !== effect.after;
  }
  return !sameDestination(effect.before, effect.after);
};

export const mailUndoOriginalSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...originalFields,
      kind: z.literal("message"),
      proof: z
        .strictObject({ effects: z.array(effectSchema).max(1000) })
        .nullable(),
    }),
    z.strictObject({
      ...originalFields,
      kind: z.literal("placement"),
      proof: z
        .strictObject({
          acceptedSequence: revisionSchema,
          effects: z.array(destinationEffectSchema).max(1000),
        })
        .nullable(),
    }),
    z.strictObject({
      ...originalFields,
      kind: z.literal("snooze"),
      proof: snoozeProofSchema.nullable(),
    }),
  ])
  .transform((original, context) => {
    const previousReturnAt =
      original.kind === "snooze" &&
      original.proof &&
      "previous" in original.proof
        ? original.proof.previous.returnAt
        : null;
    if (
      Date.parse(original.cutoff) !==
      Date.parse(
        createMailUndoCutoff({
          admittedAt: original.admittedAt,
          previousReturnAt,
        })
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The original cutoff must be fixed by its admission and prior deadline.",
      });
    }
    if (!original.proof) {
      return original;
    }
    const ownershipOnly = "guards" in original.proof;
    const effects =
      "guards" in original.proof
        ? original.proof.guards
        : original.proof.effects;
    if (
      new Set(effects.map((effect) => effect.messageId)).size !== effects.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A message can appear only once in an original action.",
      });
    }
    for (const effect of effects) {
      if (effect.outcome.status === "unchanged" && effectChanged(effect)) {
        context.addIssue({
          code: "custom",
          message: "An unchanged effect cannot contain a state change.",
        });
      }
      if (effect.facet === "destination") {
        if (effect.before.kind !== effect.after.kind) {
          context.addIssue({
            code: "custom",
            message: "A destination effect cannot change source kind.",
          });
        }
        if (
          original.kind !== "message" &&
          (placementValue(effect.before) === null ||
            placementValue(effect.after) === null)
        ) {
          context.addIssue({
            code: "custom",
            message: "Placement effects can change only Inbox and Done.",
          });
        }
      }
      if (effect.outcome.status === "acknowledged") {
        const { proof } = effect.outcome;
        if (
          (!ownershipOnly &&
            proof.kind === "gmail-acknowledged-snapshot" &&
            Date.parse(proof.acknowledgedAt) <
              Date.parse(original.admittedAt)) ||
          (effect.facet === "destination" &&
            (effect.after.kind === "managed") !==
              (proof.kind === "managed-revision"))
        ) {
          context.addIssue({
            code: "custom",
            message: "Acknowledgement does not belong to this source effect.",
          });
        }
      }
    }
    if (original.kind !== "snooze") {
      return original;
    }
    const { proof } = original;
    const { after } = proof;
    if (
      after.hiddenMessageIds.some(
        (id) => !after.knownIncomingMessageIds.includes(id)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Hidden messages must belong to the saved incoming set.",
      });
    }
    if (proof.command === "snooze") {
      if (
        !["active", "suspended"].includes(after.status) ||
        !sameIds(
          after.hiddenMessageIds,
          proof.effects.map((effect) => effect.messageId)
        ) ||
        proof.effects.some(
          (effect) =>
            placementValue(effect.before) !== "inbox" ||
            placementValue(effect.after) !== "done"
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Initial Snooze must retain its exact hidden effect set.",
        });
      }
      return original;
    }
    const { previous } = proof;
    if (
      previous.id !== after.id ||
      BigInt(previous.version) >= BigInt(after.version) ||
      previous.hideOperationId !== after.hideOperationId ||
      !sameIds(previous.hiddenMessageIds, after.hiddenMessageIds) ||
      !sameIds(
        previous.knownIncomingMessageIds,
        after.knownIncomingMessageIds
      ) ||
      previous.hiddenMessageIds.some(
        (id) => !previous.knownIncomingMessageIds.includes(id)
      ) ||
      Date.parse(original.cutoff) > Date.parse(previous.returnAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Restoration must retain the saved schedule and its earlier cutoff.",
      });
    }
    if (
      (proof.command === "reschedule" && after.status !== "active") ||
      (proof.command === "cancel" && after.status !== "cancelled") ||
      (proof.command === "return-now" && after.status !== "returned")
    ) {
      context.addIssue({
        code: "custom",
        message: "The completed Snooze transition is not legal.",
      });
    }
    if (
      "guards" in proof &&
      (!sameIds(
        previous.hiddenMessageIds,
        proof.guards.map((effect) => effect.messageId)
      ) ||
        proof.guards.some(
          (effect) =>
            !sameDestination(effect.before, effect.after) ||
            effect.outcome.status !== "acknowledged" ||
            placementValue(effect.after) !== "done"
        ))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Schedule-only changes must retain exact hidden-message ownership.",
      });
    }
    if (
      proof.command === "return-now" &&
      (!sameIds(
        previous.hiddenMessageIds,
        proof.effects.map((effect) => effect.messageId)
      ) ||
        proof.effects.some(
          (effect) =>
            placementValue(effect.before) !== "done" ||
            placementValue(effect.after) !== "inbox"
        ))
    ) {
      context.addIssue({
        code: "custom",
        message: "Return now must retain its exact returned effect set.",
      });
    }
    return original;
  });
export type MailUndoOriginal = z.infer<typeof mailUndoOriginalSchema>;

export const mailUndoCurrentMessageSchema = z.strictObject({
  destination: destinationSchema,
  destinationIntentToken: z.uuid().nullable(),
  mailboxId: sourceIdSchema,
  messageId: sourceIdSchema,
  read: z.boolean(),
  readIntentToken: z.uuid().nullable(),
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      destinationRevision: revisionSchema,
      kind: z.literal("managed-revision"),
      readRevision: revisionSchema,
    }),
    z.strictObject({
      historyId: revisionSchema,
      kind: z.literal("gmail-fresh-snapshot"),
      observedAt: instantSchema,
    }),
  ]),
  threadId: sourceIdSchema,
});
type CurrentMessage = z.infer<typeof mailUndoCurrentMessageSchema>;

export const mailUndoAttemptSchema = z
  .strictObject({
    actorUserId: sourceIdSchema,
    admittedAt: instantSchema,
    cutoff: instantSchema,
    id: z.uuid(),
    items: z.array(mailUndoItemSchema).max(1000),
    liveOriginalOperationId: z.uuid().nullable(),
    mailboxId: sourceIdSchema,
    originalKind: z.enum(["message", "placement", "snooze"]),
    originalOperationId: z.uuid(),
    state: z.enum(["accepted", "submitting", "completed", "uncertain"]),
  })
  .superRefine((attempt, context) => {
    const reference = `${attempt.originalKind}:${attempt.originalOperationId}`;
    if (
      Date.parse(attempt.admittedAt) >= Date.parse(attempt.cutoff) ||
      (attempt.liveOriginalOperationId !== null &&
        attempt.liveOriginalOperationId !== attempt.originalOperationId) ||
      attempt.items.some((item) => item.receiptId !== reference) ||
      (attempt.state !== "accepted" && attempt.items.length === 0) ||
      attempt.items.reduce((total, item) => total + item.messageIds.length, 0) >
        1000
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid accepted Undo identity.",
      });
    }
  });
export type MailUndoAttempt = z.infer<typeof mailUndoAttemptSchema>;

const authoritySchema = z.strictObject({
  actorUserId: sourceIdSchema,
  canWrite: z.boolean(),
  mailboxId: sourceIdSchema,
});
export const mailUndoAdmissionSchema = z.strictObject({
  actorUserId: sourceIdSchema,
  attemptId: z.uuid(),
  authority: authoritySchema,
  existingAttempt: mailUndoAttemptSchema.nullable(),
  mailboxId: sourceIdSchema,
  now: instantSchema,
  original: mailUndoOriginalSchema.nullable(),
  receiptId: mailUndoReceiptIdSchema,
});
type AdmissionInput = z.infer<typeof mailUndoAdmissionSchema>;

const acknowledgedChanges = (original: MailUndoOriginal): Effect[] => {
  if (!original.proof || !("effects" in original.proof)) {
    return [];
  }
  return original.proof.effects.filter(
    (effect) =>
      effect.outcome.status === "acknowledged" && effectChanged(effect)
  );
};

export const getMailUndoReceipt = (input: {
  now: string;
  original: MailUndoOriginal;
}): MailUndoReceipt | null => {
  const { original } = input;
  if (!original.proof || Date.parse(input.now) >= Date.parse(original.cutoff)) {
    return null;
  }
  if (original.kind === "snooze") {
    const { proof } = original;
    if (proof.completion !== "acknowledged") {
      return null;
    }
    if (
      proof.command === "reschedule" &&
      proof.previous.returnAt === proof.after.returnAt &&
      proof.previous.timeZone === proof.after.timeZone &&
      proof.previous.status === proof.after.status
    ) {
      return null;
    } else if (
      (proof.command === "snooze" || proof.command === "return-now") &&
      (proof.effects.length === 0 ||
        acknowledgedChanges(original).length !== proof.effects.length)
    ) {
      return null;
    }
  } else if (acknowledgedChanges(original).length === 0) {
    return null;
  }
  return {
    expiresAt: original.cutoff,
    id: mailUndoReceiptIdSchema.parse(
      `${original.kind}:${original.operationId}`
    ),
  };
};

export const admitMailUndo = (
  input: AdmissionInput
):
  | { kind: "accepted"; attempt: MailUndoAttempt }
  | { kind: "replay"; attempt: MailUndoAttempt }
  | { kind: "blocked"; reason: "denied" | "expired" | "unavailable" } => {
  const { authority, original, existingAttempt } = input;
  if (
    !authority.canWrite ||
    authority.actorUserId !== input.actorUserId ||
    authority.mailboxId !== input.mailboxId
  ) {
    return { kind: "blocked", reason: "denied" };
  }
  if (existingAttempt) {
    if (
      existingAttempt.actorUserId !== input.actorUserId ||
      existingAttempt.mailboxId !== input.mailboxId ||
      `${existingAttempt.originalKind}:${existingAttempt.originalOperationId}` !==
        input.receiptId
    ) {
      return { kind: "blocked", reason: "denied" };
    }
    return { attempt: existingAttempt, kind: "replay" };
  }
  if (
    !original ||
    original.actorUserId !== input.actorUserId ||
    original.mailboxId !== input.mailboxId ||
    `${original.kind}:${original.operationId}` !== input.receiptId
  ) {
    return { kind: "blocked", reason: "unavailable" };
  }
  if (Date.parse(input.now) >= Date.parse(original.cutoff)) {
    return { kind: "blocked", reason: "expired" };
  }
  if (!getMailUndoReceipt({ now: input.now, original })) {
    return { kind: "blocked", reason: "unavailable" };
  }
  return {
    attempt: {
      actorUserId: input.actorUserId,
      admittedAt: input.now,
      cutoff: original.cutoff,
      id: input.attemptId,
      items: [],
      liveOriginalOperationId: original.operationId,
      mailboxId: input.mailboxId,
      originalKind: original.kind,
      originalOperationId: original.operationId,
      state: "accepted",
    },
    kind: "accepted",
  };
};

const inverseSchema = z.discriminatedUnion("facet", [
  z.strictObject({
    expectedIntentToken: z.uuid(),
    facet: z.literal("read"),
    messageId: sourceIdSchema,
    read: z.boolean(),
    sourceProof: sourceProofSchema,
  }),
  z.strictObject({
    destination: destinationSchema,
    expectedIntentToken: z.uuid(),
    facet: z.literal("destination"),
    messageId: sourceIdSchema,
    sourceProof: sourceProofSchema,
  }),
]);
type Inverse = z.infer<typeof inverseSchema>;
const snoozeRestorationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("retire") }),
  z.strictObject({
    kind: z.literal("restore"),
    schedule: restoredScheduleSchema,
  }),
  z.strictObject({
    kind: z.literal("rehide"),
    predecessorHideOperationId: z.uuid(),
    template: restoredScheduleSchema.omit({ hideOperationId: true }),
  }),
]);
const snoozeUndoPlanSchema = z
  .strictObject({
    effects: z.array(inverseSchema).max(1000),
    expectedVersion: revisionSchema,
    kind: z.literal("snooze"),
    nextVersion: revisionSchema,
    restoration: snoozeRestorationSchema,
    scheduleId: z.uuid(),
    scope: z.strictObject({
      actorUserId: sourceIdSchema,
      attemptId: z.uuid(),
      mailboxId: sourceIdSchema,
      threadId: sourceIdSchema,
    }),
  })
  .transform((plan, context) => {
    const ids = plan.effects.map((effect) => effect.messageId);
    const { restoration } = plan;
    if (
      BigInt(plan.nextVersion) !== BigInt(plan.expectedVersion) + 1n ||
      new Set(ids).size !== ids.length ||
      plan.effects.some((effect) => effect.facet !== "destination") ||
      (restoration.kind === "restore" &&
        (plan.effects.length !== 0 ||
          restoration.schedule.id !== plan.scheduleId ||
          restoration.schedule.hiddenMessageIds.some(
            (id) => !restoration.schedule.knownIncomingMessageIds.includes(id)
          ))) ||
      (restoration.kind === "retire" &&
        (plan.effects.length === 0 ||
          plan.effects.some(
            (effect) =>
              effect.facet === "destination" &&
              placementValue(effect.destination) !== "inbox"
          ))) ||
      (restoration.kind === "rehide" &&
        (ids.length === 0 ||
          restoration.template.id !== plan.scheduleId ||
          !sameIds(ids, restoration.template.hiddenMessageIds) ||
          restoration.template.hiddenMessageIds.some(
            (id) => !restoration.template.knownIncomingMessageIds.includes(id)
          ) ||
          plan.effects.some(
            (effect) =>
              effect.facet === "destination" &&
              placementValue(effect.destination) !== "done"
          )))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid Snooze compensation plan.",
      });
    }
    return plan;
  });
export const mailUndoPlanSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    effects: z.array(inverseSchema).max(1000),
    kind: z.literal("message"),
  }),
  z.strictObject({
    effects: z.array(inverseSchema).max(1000),
    expectedSequence: revisionSchema,
    kind: z.literal("placement"),
  }),
  snoozeUndoPlanSchema,
]);
export type MailUndoPlan = z.infer<typeof mailUndoPlanSchema>;

export const mailUndoRehideBindingSchema = z.strictObject({
  outcome: z.discriminatedUnion("status", [
    z.strictObject({
      acknowledgedMessageIds: messageIdsSchema.min(1),
      actorUserId: sourceIdSchema,
      mailboxId: sourceIdSchema,
      operationId: z.uuid(),
      placement: z.enum(["done", "inbox"]),
      requestId: sourceIdSchema,
      requestedMessageIds: messageIdsSchema.min(1),
      status: z.literal("acknowledged"),
      threadId: sourceIdSchema,
    }),
    z.strictObject({
      status: z.enum([
        "prepared",
        "submitting",
        "uncertain",
        "failed",
        "observed-applied",
      ]),
    }),
  ]),
  phase: z.strictObject({ attemptId: z.uuid(), requestId: sourceIdSchema }),
  plan: snoozeUndoPlanSchema,
});
type RehideBinding = z.infer<typeof mailUndoRehideBindingSchema>;

export const bindMailUndoRehide = (
  input: RehideBinding
):
  | { kind: "bound"; schedule: z.infer<typeof restoredScheduleSchema> }
  | { kind: "blocked"; reason: "unacknowledged" | "mismatched" } => {
  const { plan, phase, outcome } = input;
  if (outcome.status !== "acknowledged") {
    return { kind: "blocked", reason: "unacknowledged" };
  }
  const { restoration, scope } = plan;
  const ids = plan.effects.map((effect) => effect.messageId);
  if (
    restoration.kind !== "rehide" ||
    phase.attemptId !== scope.attemptId ||
    outcome.requestId !== phase.requestId ||
    outcome.actorUserId !== scope.actorUserId ||
    outcome.mailboxId !== scope.mailboxId ||
    outcome.threadId !== scope.threadId ||
    outcome.placement !== "done" ||
    outcome.operationId === restoration.predecessorHideOperationId ||
    !sameIds(ids, outcome.requestedMessageIds) ||
    !sameIds(ids, outcome.acknowledgedMessageIds)
  ) {
    return { kind: "blocked", reason: "mismatched" };
  }
  return {
    kind: "bound",
    schedule: {
      ...restoration.template,
      hiddenMessageIds: [...restoration.template.hiddenMessageIds],
      hideOperationId: outcome.operationId,
      knownIncomingMessageIds: [
        ...restoration.template.knownIncomingMessageIds,
      ],
    },
  };
};

export const mailUndoPlanningSchema = z.strictObject({
  actorUserId: sourceIdSchema,
  attempt: mailUndoAttemptSchema,
  authority: authoritySchema,
  currentMessages: z
    .array(mailUndoCurrentMessageSchema)
    .max(1000)
    .refine(
      (messages) =>
        new Set(messages.map((message) => message.messageId)).size ===
        messages.length
    ),
  currentSchedule: z
    .strictObject({
      incomingMessageIds: messageIdsSchema,
      mailboxId: sourceIdSchema,
      schedule: scheduleSchema,
      threadId: sourceIdSchema,
    })
    .nullable(),
  latestPlacementSequence: revisionSchema.nullable(),
  mailboxId: sourceIdSchema,
  now: instantSchema,
  original: mailUndoOriginalSchema,
});
type PlanningInput = z.infer<typeof mailUndoPlanningSchema>;

const effectBlock = (
  effect: Effect,
  current: CurrentMessage | undefined,
  original: MailUndoOriginal,
  now: string,
  ownershipOnly = false
): MailUndoItem["status"] | null => {
  if (effect.outcome.status !== "acknowledged") {
    if (
      ["submitting", "uncertain", "observed-applied"].includes(
        effect.outcome.status
      )
    ) {
      return "uncertain";
    }
    return effect.outcome.status === "unchanged" ? "unchanged" : "failed";
  }
  if (!effectChanged(effect) && !ownershipOnly) {
    return "unchanged";
  }
  if (
    !current ||
    current.threadId !== original.threadId ||
    current.mailboxId !== original.mailboxId
  ) {
    return "changed";
  }
  const intent =
    effect.facet === "read"
      ? current.readIntentToken
      : current.destinationIntentToken;
  if (
    intent !== effect.intentToken ||
    (effect.facet === "read"
      ? current.read !== effect.after
      : !sameDestination(current.destination, effect.after))
  ) {
    return "changed";
  }
  const { proof } = effect.outcome;
  if (proof.kind === "managed-revision") {
    if (
      current.source.kind !== "managed-revision" ||
      current.destination.kind !== "managed"
    ) {
      return "changed";
    }
    const revision =
      effect.facet === "read"
        ? current.source.readRevision
        : current.source.destinationRevision;
    return revision === proof.revision ? null : "changed";
  }
  if (
    current.source.kind !== "gmail-fresh-snapshot" ||
    current.destination.kind !== "gmail" ||
    current.source.historyId !== proof.historyId ||
    Date.parse(current.source.observedAt) < Date.parse(proof.snapshotAt) ||
    Date.parse(current.source.observedAt) > Date.parse(now)
  ) {
    return "changed";
  }
  return null;
};

export const planMailUndo = (
  input: PlanningInput
): { items: MailUndoItem[]; plan: MailUndoPlan | null } => {
  const { original, attempt, authority } = input;
  const receiptId = mailUndoReceiptIdSchema.parse(
    `${original.kind}:${original.operationId}`
  );
  const item = (
    status: MailUndoItem["status"],
    messageIds: string[]
  ): MailUndoItem => {
    const fields = {
      messageIds,
      receiptId,
      replayed: false,
      threadId: original.threadId,
    };
    if (status === "compensated" || status === "unchanged") {
      return { ...fields, status };
    }
    const messages = {
      changed: "This mail changed after your action. Refresh and try again.",
      denied: "You no longer have permission to undo this action.",
      expired: "This action can no longer be undone.",
      failed: "This action could not be undone. Please try again.",
      pending: "Undo is ready to finish.",
      uncertain:
        "This action has not been confirmed. Refresh before trying again.",
    };
    return {
      ...fields,
      code: `undo_${status}`,
      message: messages[status],
      status,
    };
  };
  const effects =
    original.proof && "effects" in original.proof ? original.proof.effects : [];
  const messageIds = effects.map((effect) => effect.messageId);
  if (
    !authority.canWrite ||
    authority.actorUserId !== input.actorUserId ||
    authority.mailboxId !== input.mailboxId ||
    original.actorUserId !== input.actorUserId ||
    original.mailboxId !== input.mailboxId ||
    attempt.actorUserId !== input.actorUserId ||
    attempt.mailboxId !== input.mailboxId ||
    attempt.originalKind !== original.kind ||
    attempt.originalOperationId !== original.operationId
  ) {
    return { items: [item("denied", [])], plan: null };
  }
  if (attempt.state !== "accepted") {
    return {
      items: attempt.items.map((result) => ({ ...result, replayed: true })),
      plan: null,
    };
  }
  if (
    attempt.liveOriginalOperationId === null ||
    attempt.cutoff !== original.cutoff ||
    Date.parse(attempt.admittedAt) < Date.parse(original.admittedAt) ||
    !getMailUndoReceipt({ now: attempt.admittedAt, original })
  ) {
    return { items: [item("failed", [])], plan: null };
  }
  if (
    original.kind === "placement" &&
    original.proof &&
    input.latestPlacementSequence !== original.proof.acceptedSequence
  ) {
    return { items: [item("changed", messageIds)], plan: null };
  }
  const inverses: Inverse[] = [];
  const items: MailUndoItem[] = [];
  for (const effect of effects) {
    const blocked = effectBlock(
      effect,
      input.currentMessages.find(
        (message) => message.messageId === effect.messageId
      ),
      original,
      input.now
    );
    if (blocked) {
      items.push(item(blocked, [effect.messageId]));
    } else if (effect.outcome.status === "acknowledged") {
      const inverse = {
        expectedIntentToken: effect.intentToken,
        messageId: effect.messageId,
        sourceProof: effect.outcome.proof,
      };
      inverses.push(
        effect.facet === "read"
          ? { ...inverse, facet: "read", read: effect.before }
          : { ...inverse, destination: effect.before, facet: "destination" }
      );
      items.push(item("pending", [effect.messageId]));
    }
  }
  if (original.kind === "message") {
    return {
      items,
      plan: inverses.length ? { effects: inverses, kind: "message" } : null,
    };
  }
  if (original.kind === "placement" && original.proof) {
    return {
      items,
      plan: inverses.length
        ? {
            effects: inverses,
            expectedSequence: original.proof.acceptedSequence,
            kind: "placement",
          }
        : null,
    };
  }
  if (original.kind !== "snooze" || !original.proof) {
    return { items: [item("failed", [])], plan: null };
  }
  const { proof } = original;
  const current = input.currentSchedule;
  if (
    !current ||
    current.mailboxId !== original.mailboxId ||
    current.threadId !== original.threadId ||
    current.schedule.id !== proof.after.id ||
    current.schedule.version !== proof.after.version ||
    current.schedule.status !== proof.after.status ||
    current.schedule.returnAt !== proof.after.returnAt ||
    current.schedule.timeZone !== proof.after.timeZone ||
    current.schedule.hideOperationId !== proof.after.hideOperationId ||
    !sameIds(current.schedule.hiddenMessageIds, proof.after.hiddenMessageIds) ||
    !sameIds(
      current.schedule.knownIncomingMessageIds,
      proof.after.knownIncomingMessageIds
    ) ||
    current.incomingMessageIds.some(
      (id) => !proof.after.knownIncomingMessageIds.includes(id)
    ) ||
    ("previous" in proof &&
      Date.parse(proof.previous.returnAt) <= Date.parse(input.now)) ||
    ("guards" in proof &&
      proof.guards.some(
        (guard) =>
          effectBlock(
            guard,
            input.currentMessages.find(
              (message) => message.messageId === guard.messageId
            ),
            original,
            input.now,
            true
          ) !== null
      )) ||
    items.some((result) => result.status !== "pending")
  ) {
    return {
      items: [
        item(
          items.some((result) => result.status === "uncertain")
            ? "uncertain"
            : "changed",
          messageIds
        ),
      ],
      plan: null,
    };
  }
  let restoration: z.infer<typeof snoozeRestorationSchema>;
  if (proof.command === "snooze") {
    restoration = { kind: "retire" };
  } else {
    const template = {
      hiddenMessageIds: proof.previous.hiddenMessageIds,
      id: proof.previous.id,
      knownIncomingMessageIds: proof.previous.knownIncomingMessageIds,
      returnAt: proof.previous.returnAt,
      status: proof.previous.status,
      timeZone: proof.previous.timeZone,
    };
    restoration =
      proof.command === "return-now"
        ? {
            kind: "rehide",
            predecessorHideOperationId: proof.previous.hideOperationId,
            template,
          }
        : {
            kind: "restore",
            schedule: {
              ...template,
              hideOperationId: proof.previous.hideOperationId,
            },
          };
  }
  return {
    items: items.length ? items : [item("pending", [])],
    plan: {
      effects: inverses,
      expectedVersion: proof.after.version,
      kind: "snooze",
      nextVersion: (BigInt(proof.after.version) + 1n).toString(),
      restoration,
      scheduleId: proof.after.id,
      scope: {
        actorUserId: original.actorUserId,
        attemptId: attempt.id,
        mailboxId: original.mailboxId,
        threadId: original.threadId,
      },
    },
  };
};
