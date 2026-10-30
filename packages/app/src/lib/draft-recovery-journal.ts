import { mailCache } from "./mail-cache";

export type DraftRecoveryScope = { userId: string; mailboxId: string };
export type LocalDraftRecord = DraftRecoveryScope & {
  editorId: string;
  localId: string;
  payload: string;
  updatedAt: number;
  revision: string;
};

export const createDraftRecoveryJournal = (cache = mailCache) => {
  const activeEditors = new Map<
    string,
    DraftRecoveryScope & { sessionId: string | undefined }
  >();
  const revokedEditors = new Set<string>();
  let current:
    | {
        userId: string;
        sessionId: string;
        storage: ReturnType<typeof cache.recoverySession>;
        ready: Promise<void>;
      }
    | undefined;
  let channel: BroadcastChannel | undefined;
  const listeners = new Set<() => void>();
  const connectNotifications = () => {
    try {
      if (!channel && typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel("quieter-draft-recovery");
        channel.addEventListener("message", () => {
          for (const listener of listeners) {
            listener();
          }
        });
      }
    } catch {
      /* The browser may deny cross-tab messaging. */
    }
  };
  const notify = () => {
    connectNotifications();
    for (const listener of listeners) {
      listener();
    }
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel only accepts a message.
      channel?.postMessage(null);
    } catch {
      /* The browser may deny cross-tab messaging. */
    }
  };
  const captureCleanup = () => {
    const activation = current;
    return async () => {
      if (
        current?.sessionId === activation?.sessionId &&
        current?.userId === activation?.userId
      ) {
        current?.storage.detach();
        current = undefined;
      }
      for (const [editorId, scope] of activeEditors) {
        if (scope.sessionId === activation?.sessionId) {
          revokedEditors.add(editorId);
        }
      }
      await activation?.storage.clear();
      notify();
    };
  };
  return {
    captureCleanup,
    session(userId: string, sessionId: string | undefined) {
      return {
        async list(scope: DraftRecoveryScope) {
          const observed =
            current?.userId === userId && current.sessionId === sessionId
              ? current
              : undefined;
          return observed && scope.userId === userId
            ? await observed.storage.list(scope)
            : [];
        },
        async listRecoverable(scope: DraftRecoveryScope) {
          const observed =
            current?.userId === userId && current.sessionId === sessionId
              ? current
              : undefined;
          if (
            !observed ||
            scope.userId !== userId ||
            [...activeEditors.values()].some(
              (editor) =>
                editor.userId === userId && editor.mailboxId === scope.mailboxId
            )
          ) {
            return [];
          }
          return await observed.storage.list(scope);
        },
        async ready() {
          const observed =
            current?.userId === userId && current.sessionId === sessionId
              ? current
              : undefined;
          if (!observed) {
            return false;
          }
          await observed.ready;
          return await observed.storage.ready;
        },
        registerEditor(record: DraftRecoveryScope & { editorId: string }) {
          if (
            current?.userId === userId &&
            current.sessionId === sessionId &&
            record.userId === userId
          ) {
            activeEditors.set(record.editorId, { ...record, sessionId });
          }
          return () => {
            activeEditors.delete(record.editorId);
          };
        },
        async remove(
          record: Pick<
            LocalDraftRecord,
            "userId" | "mailboxId" | "editorId" | "localId"
          > & { revision?: string }
        ) {
          const observed =
            current?.userId === userId && current.sessionId === sessionId
              ? current
              : undefined;
          if (
            !observed ||
            record.userId !== userId ||
            revokedEditors.has(record.editorId)
          ) {
            return;
          }
          await observed.storage.remove(record);
          notify();
        },
        async save(record: Omit<LocalDraftRecord, "revision">) {
          const observed =
            current?.userId === userId && current.sessionId === sessionId
              ? current
              : undefined;
          if (
            !observed ||
            record.userId !== userId ||
            revokedEditors.has(record.editorId)
          ) {
            return;
          }
          if (record.payload.length > 4 * 1024 * 1024) {
            throw new Error("This draft is too large to keep a recovery copy.");
          }
          await observed.storage.save(record);
          notify();
        },
      };
    },
    async setUser(userId: string | undefined, sessionId = userId) {
      if (!userId || !sessionId) {
        await captureCleanup()();
        return;
      }
      if (current?.userId === userId && current.sessionId === sessionId) {
        await current.ready;
        return;
      }
      for (const editorId of activeEditors.keys()) {
        revokedEditors.add(editorId);
      }
      current?.storage.detach();
      const storage = cache.recoverySession(userId, sessionId);
      const ready = storage.migrateLegacy();
      current = { ready, sessionId, storage, userId };
      await ready;
    },
    subscribe(subscription: () => void) {
      listeners.add(subscription);
      connectNotifications();
      return () => {
        listeners.delete(subscription);
      };
    },
  };
};

export const draftRecoveryJournal = createDraftRecoveryJournal();
