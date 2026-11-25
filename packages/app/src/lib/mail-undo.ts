import { mailUndoResultSchema } from "@quieter/mail/undo";
import type {
  MailUndoInput,
  MailUndoOffer,
  MailUndoReceiptId,
  MailUndoResult,
} from "@quieter/mail/undo";
import { createStore } from "@tanstack/react-store";

export type MailUndoScope = {
  readonly accountId: string;
  readonly sessionId: string;
  readonly mailboxIds: ReadonlySet<MailUndoInput["mailboxId"]>;
};

const gestureBrand = Symbol("mail-undo-gesture");

export type MailUndoGesture = {
  readonly [gestureBrand]: symbol;
};

export type MailUndoExecution = (request: {
  readonly scope: Pick<MailUndoScope, "accountId" | "sessionId">;
  readonly input: MailUndoInput;
}) => Promise<unknown>;

export type MailUndoSourceOutcome =
  | {
      readonly kind: "acknowledged";
      readonly result: MailUndoResult;
    }
  | {
      readonly kind: "unconfirmed";
      readonly mailboxId: MailUndoInput["mailboxId"];
      readonly receiptIds: readonly MailUndoReceiptId[];
      readonly failure:
        | { readonly kind: "request"; readonly error: unknown }
        | { readonly kind: "invalid-response" };
    };

export type MailUndoCompletion = {
  readonly sources: readonly MailUndoSourceOutcome[];
};

export type MailUndoSnapshot =
  | { readonly kind: "inactive"; readonly reason: "unconfigured" | "disposed" }
  | { readonly kind: "idle"; readonly scope: MailUndoScope }
  | {
      readonly kind: "offered";
      readonly scope: MailUndoScope;
      readonly eligibleMailboxIds: readonly MailUndoInput["mailboxId"][];
      readonly lastCompletion: MailUndoCompletion | null;
    }
  | {
      readonly kind: "pending";
      readonly scope: MailUndoScope;
      readonly lastCompletion: MailUndoCompletion | null;
    }
  | {
      readonly kind: "completed";
      readonly scope: MailUndoScope;
      readonly lastCompletion: MailUndoCompletion;
    };

export type MailUndoController = {
  readonly state: Pick<
    ReturnType<typeof createStore<MailUndoSnapshot>>,
    "get" | "subscribe"
  >;
  readonly setScope: (scope: MailUndoScope | null) => void;
  readonly beginGesture: () => MailUndoGesture | null;
  readonly publishOffer: (publication: {
    readonly gesture: MailUndoGesture;
    readonly offer: MailUndoOffer;
  }) => "accepted" | "ignored" | "limit";
  readonly execute: () => Promise<void>;
  readonly dispose: () => void;
};

type ReceiptSlot = {
  readonly receiptId: MailUndoReceiptId;
  readonly expiresAt: number;
  readonly availability: "available" | "retired";
};

type Gesture = {
  readonly identity: MailUndoGesture;
  readonly sequence: number;
  readonly receipts: ReadonlyMap<string, readonly ReceiptSlot[]>;
};

type Submission = {
  readonly identity: symbol;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

type ActiveFields = {
  readonly generation: symbol;
  readonly scope: MailUndoScope;
};

type InternalState =
  | Extract<MailUndoSnapshot, { kind: "inactive" }>
  | (ActiveFields &
      Extract<MailUndoSnapshot, { kind: "idle" }> & {
        readonly gesture: Gesture | null;
      })
  | (ActiveFields &
      Extract<MailUndoSnapshot, { kind: "offered" | "completed" }> & {
        readonly gesture: Gesture;
      })
  | (ActiveFields &
      Extract<MailUndoSnapshot, { kind: "pending" }> & {
        readonly gesture: Gesture;
        readonly submission: Submission;
      });

type ReadyContext = ActiveFields & {
  readonly gesture: Gesture;
  readonly lastCompletion: MailUndoCompletion | null;
};

type ReadyState = Exclude<InternalState, { kind: "inactive" | "pending" }>;

const expireGesture = (gesture: Gesture, now: number): Gesture => {
  const receipts = new Map<string, readonly ReceiptSlot[]>();
  for (const [mailboxId, slots] of gesture.receipts) {
    receipts.set(
      mailboxId,
      slots.map((slot) =>
        slot.availability === "available" && slot.expiresAt <= now
          ? { ...slot, availability: "retired" }
          : slot
      )
    );
  }
  return { ...gesture, receipts };
};

const readyState = (context: ReadyContext, now: number): ReadyState => {
  const gesture = expireGesture(context.gesture, now);
  const fields = {
    generation: context.generation,
    gesture,
    scope: context.scope,
  };
  const eligibleMailboxIds = [...gesture.receipts]
    .filter(([, slots]) =>
      slots.some((slot) => slot.availability === "available")
    )
    .map(([mailboxId]) => mailboxId)
    .toSorted();
  if (eligibleMailboxIds.length > 0) {
    return {
      ...fields,
      eligibleMailboxIds,
      kind: "offered",
      lastCompletion: context.lastCompletion,
    };
  }
  if (context.lastCompletion) {
    return {
      ...fields,
      kind: "completed",
      lastCompletion: context.lastCompletion,
    };
  }
  return {
    ...fields,
    kind: "idle",
  };
};

export const createMailUndoController = (
  executeUndo: MailUndoExecution
): MailUndoController => {
  const state = createStore<InternalState>({
    kind: "inactive",
    reason: "unconfigured",
  });
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const commit = (next: InternalState) => {
    clearTimeout(timer);
    timer = undefined;
    state.setState(() => next);
    if (
      state.get() !== next ||
      next.kind === "inactive" ||
      next.gesture === null
    ) {
      return;
    }
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const slots of next.gesture.receipts.values()) {
      for (const slot of slots) {
        if (slot.availability === "available") {
          nextExpiry = Math.min(nextExpiry, slot.expiresAt);
        }
      }
    }
    if (!Number.isFinite(nextExpiry)) {
      return;
    }
    const { generation } = next;
    const token = next.gesture.identity;
    timer = setTimeout(
      () => {
        const current = state.get();
        if (
          current.kind === "inactive" ||
          current.generation !== generation ||
          current.gesture?.identity !== token
        ) {
          return;
        }
        if (current.kind === "pending") {
          commit({
            ...current,
            gesture: expireGesture(current.gesture, Date.now()),
          });
        } else {
          commit(
            readyState(
              {
                ...current,
                gesture: current.gesture,
                lastCompletion:
                  "lastCompletion" in current ? current.lastCompletion : null,
              },
              Date.now()
            )
          );
        }
      },
      Math.min(Math.max(0, nextExpiry - Date.now()), 2_147_483_647)
    );
  };

  return {
    beginGesture() {
      const current = state.get();
      if (current.kind === "inactive") {
        return null;
      }
      if (current.kind === "pending") {
        current.submission.resolve();
      }
      sequence += 1;
      const identity: MailUndoGesture = {
        [gestureBrand]: Symbol("mail-undo-gesture"),
      };
      commit({
        generation: current.generation,
        gesture: { identity, receipts: new Map(), sequence },
        kind: "idle",
        scope: current.scope,
      });
      return identity;
    },
    dispose() {
      const current = state.get();
      if (current.kind === "inactive" && current.reason === "disposed") {
        return;
      }
      if (current.kind === "pending") {
        current.submission.resolve();
      }
      commit({ kind: "inactive", reason: "disposed" });
    },
    // oxlint-disable-next-line typescript/promise-function-async -- Async wrapping would replace the shared in-flight promise.
    execute() {
      const current = state.get();
      if (current.kind === "pending") {
        return current.submission.promise;
      }
      if (current.kind === "inactive" || current.gesture === null) {
        return Promise.resolve();
      }
      const ready = readyState(
        {
          ...current,
          gesture: current.gesture,
          lastCompletion:
            "lastCompletion" in current ? current.lastCompletion : null,
        },
        Date.now()
      );
      if (ready.kind !== "offered") {
        commit(ready);
        return Promise.resolve();
      }
      const inputs: MailUndoInput[] = [];
      const receipts = new Map<string, readonly ReceiptSlot[]>();
      for (const [mailboxId, slots] of ready.gesture.receipts) {
        const selected = slots.filter(
          (slot) => slot.availability === "available"
        );
        if (selected.length > 0) {
          inputs.push({
            mailboxId,
            receipts: selected.map((slot) => slot.receiptId).toSorted(),
          });
        }
        receipts.set(
          mailboxId,
          slots.map((slot) => ({ ...slot, availability: "retired" }))
        );
      }
      // oxlint-disable-next-line typescript/no-invalid-void-type -- This deferred resolves without a value, as its public promise requires.
      const deferred = Promise.withResolvers<void>();
      const submission: Submission = {
        identity: Symbol("mail-undo-submission"),
        promise: deferred.promise,
        resolve: () => {
          deferred.resolve();
        },
      };
      const token = ready.gesture.identity;
      const { generation } = ready;
      const pending: InternalState = {
        generation,
        gesture: { ...ready.gesture, receipts },
        kind: "pending",
        lastCompletion: ready.lastCompletion,
        scope: ready.scope,
        submission,
      };
      commit(pending);
      const calls: { input: MailUndoInput; promise: Promise<unknown> }[] = [];
      for (const input of inputs) {
        const latest = state.get();
        if (
          latest.kind !== "pending" ||
          latest.generation !== generation ||
          latest.gesture.identity !== token ||
          latest.submission.identity !== submission.identity
        ) {
          break;
        }
        calls.push({
          input,
          promise: (async () =>
            await executeUndo({
              input: {
                mailboxId: input.mailboxId,
                receipts: [...input.receipts],
              },
              scope: {
                accountId: ready.scope.accountId,
                sessionId: ready.scope.sessionId,
              },
            }))(),
        });
      }
      void (async () => {
        const results = await Promise.allSettled(
          calls.map(async (call) => await call.promise)
        );
        const latest = state.get();
        if (
          latest.kind !== "pending" ||
          latest.generation !== generation ||
          latest.gesture.identity !== token ||
          latest.submission.identity !== submission.identity
        ) {
          deferred.resolve();
          return;
        }
        const sources: MailUndoSourceOutcome[] = [];
        for (const [index, call] of calls.entries()) {
          const outcome = results[index];
          if (outcome === undefined) {
            throw new Error("An Undo source did not settle.");
          }
          const { input } = call;
          if (outcome.status === "rejected") {
            sources.push({
              failure: { error: outcome.reason, kind: "request" },
              kind: "unconfirmed",
              mailboxId: input.mailboxId,
              receiptIds: input.receipts,
            });
            continue;
          }
          const parsed = mailUndoResultSchema.safeParse(outcome.value);
          const expected = new Set(input.receipts);
          if (
            !parsed.success ||
            parsed.data.mailboxId !== input.mailboxId ||
            parsed.data.items.some((item) => !expected.has(item.receiptId)) ||
            input.receipts.some(
              (id) => !parsed.data.items.some((item) => item.receiptId === id)
            )
          ) {
            sources.push({
              failure: { kind: "invalid-response" },
              kind: "unconfirmed",
              mailboxId: input.mailboxId,
              receiptIds: input.receipts,
            });
          } else {
            sources.push({ kind: "acknowledged", result: parsed.data });
          }
        }
        commit(
          readyState({ ...latest, lastCompletion: { sources } }, Date.now())
        );
        deferred.resolve();
      })();
      return deferred.promise;
    },
    publishOffer({ gesture, offer }) {
      const current = state.get();
      if (
        current.kind === "inactive" ||
        current.gesture?.identity !== gesture ||
        !current.scope.mailboxIds.has(offer.mailboxId)
      ) {
        return "ignored";
      }
      const previous = current.gesture.receipts.get(offer.mailboxId) ?? [];
      const seen = new Set(previous.map((slot) => slot.receiptId));
      const additions: ReceiptSlot[] = [];
      const now = Date.now();
      for (const receipt of offer.receipts) {
        if (!seen.has(receipt.id)) {
          seen.add(receipt.id);
          const expiresAt = Date.parse(receipt.expiresAt);
          additions.push({
            availability: expiresAt > now ? "available" : "retired",
            expiresAt,
            receiptId: receipt.id,
          });
        }
      }
      if (previous.length + additions.length > 1000) {
        return "limit";
      }
      if (additions.length === 0) {
        return "ignored";
      }
      const receipts = new Map<string, readonly ReceiptSlot[]>([
        ...current.gesture.receipts,
        [offer.mailboxId, [...previous, ...additions]],
      ]);
      const updated = {
        ...current,
        gesture: { ...current.gesture, receipts },
      };
      commit(
        updated.kind === "pending"
          ? updated
          : readyState(
              {
                ...updated,
                lastCompletion:
                  "lastCompletion" in updated ? updated.lastCompletion : null,
              },
              now
            )
      );
      return "accepted";
    },
    setScope(scope) {
      const current = state.get();
      if (
        current.kind === "inactive" &&
        (current.reason === "disposed" || scope === null)
      ) {
        return;
      }
      if (
        scope !== null &&
        current.kind !== "inactive" &&
        scope.accountId === current.scope.accountId &&
        scope.sessionId === current.scope.sessionId &&
        scope.mailboxIds.size === current.scope.mailboxIds.size &&
        [...scope.mailboxIds].every((id) => current.scope.mailboxIds.has(id))
      ) {
        return;
      }
      if (current.kind === "pending") {
        current.submission.resolve();
      }
      commit(
        scope === null
          ? { kind: "inactive", reason: "unconfigured" }
          : {
              generation: Symbol("mail-undo-scope"),
              gesture: null,
              kind: "idle",
              scope: { ...scope, mailboxIds: new Set(scope.mailboxIds) },
            }
      );
    },
    state: {
      get: state.get.bind(state),
      subscribe: state.subscribe.bind(state),
    },
  };
};
