export type DraftRecoveryScope = {
  userId: string;
  mailboxId: string;
};

export type LocalDraftRecord = DraftRecoveryScope & {
  editorId: string;
  localId: string;
  payload: string;
  updatedAt: number;
};

const LEGACY_STORAGE_KEY_PREFIX = "quieter:draft-recovery:";
const STORAGE_KEY_PREFIX = "quieter:draft-recovery-v2:";
const MAX_RECORDS_PER_MAILBOX = 3;
const MAX_PAYLOAD_LENGTH = 4 * 1024 * 1024;
const activeEditors = new Map<string, DraftRecoveryScope>();
const revokedEditors = new Set<string>();
let identity:
  | { state: "unbound" }
  | { state: "bound"; userId: string | undefined } = { state: "unbound" };

const isRecord = (value: unknown): value is LocalDraftRecord =>
  typeof value === "object" &&
  value !== null &&
  "userId" in value &&
  typeof value.userId === "string" &&
  "editorId" in value &&
  typeof value.editorId === "string" &&
  "localId" in value &&
  typeof value.localId === "string" &&
  "mailboxId" in value &&
  typeof value.mailboxId === "string" &&
  "payload" in value &&
  typeof value.payload === "string" &&
  "updatedAt" in value &&
  typeof value.updatedAt === "number";

const storageKey = ({ userId, mailboxId }: DraftRecoveryScope) =>
  `${STORAGE_KEY_PREFIX}${JSON.stringify([userId, mailboxId])}`;

const readRecords = (scope: DraftRecoveryScope): LocalDraftRecord[] => {
  if (identity.state === "bound" && scope.userId !== identity.userId) {
    return [];
  }
  try {
    localStorage.removeItem(`${LEGACY_STORAGE_KEY_PREFIX}${scope.mailboxId}`);
    const raw = localStorage.getItem(storageKey(scope));
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter(isRecord)
          .filter(
            (record) =>
              record.userId === scope.userId &&
              record.mailboxId === scope.mailboxId
          )
      : [];
  } catch {
    return [];
  }
};

const writeRecords = (
  scope: DraftRecoveryScope,
  records: LocalDraftRecord[]
) => {
  const key = storageKey(scope);
  if (records.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(records));
  } catch (error) {
    throw new Error("Draft recovery storage is unavailable.", { cause: error });
  }
};

export const draftRecoveryJournal = {
  clearUser: (userId: string | undefined) => {
    for (const [editorId, scope] of activeEditors) {
      if (scope.userId === userId) {
        revokedEditors.add(editorId);
      }
    }
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (
        key === null ||
        (!key.startsWith(STORAGE_KEY_PREFIX) &&
          !key.startsWith(LEGACY_STORAGE_KEY_PREFIX))
      ) {
        continue;
      }
      if (key.startsWith(LEGACY_STORAGE_KEY_PREFIX)) {
        localStorage.removeItem(key);
        continue;
      }
      try {
        const scope: unknown = JSON.parse(key.slice(STORAGE_KEY_PREFIX.length));
        if (Array.isArray(scope) && scope[0] === userId) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  },
  list: (scope: DraftRecoveryScope): LocalDraftRecord[] =>
    readRecords(scope).toSorted(
      (left, right) => right.updatedAt - left.updatedAt
    ),
  listRecoverable: (scope: DraftRecoveryScope): LocalDraftRecord[] =>
    [...activeEditors.values()].some(
      (editor) =>
        editor.userId === scope.userId && editor.mailboxId === scope.mailboxId
    )
      ? []
      : readRecords(scope).toSorted(
          (left, right) => right.updatedAt - left.updatedAt
        ),
  registerEditor: (record: DraftRecoveryScope & { editorId: string }) => {
    activeEditors.set(record.editorId, record);
    return () => {
      activeEditors.delete(record.editorId);
    };
  },
  remove: (
    record: Pick<
      LocalDraftRecord,
      "editorId" | "localId" | "mailboxId" | "userId"
    > &
      Partial<Pick<LocalDraftRecord, "updatedAt">>
  ) => {
    if (identity.state !== "bound" || record.userId !== identity.userId) {
      return;
    }
    writeRecords(
      record,
      readRecords(record).filter(
        (current) =>
          current.editorId !== record.editorId ||
          current.localId !== record.localId ||
          (record.updatedAt !== undefined &&
            current.updatedAt !== record.updatedAt)
      )
    );
  },
  save: (record: LocalDraftRecord) => {
    if (
      identity.state !== "bound" ||
      record.userId !== identity.userId ||
      revokedEditors.has(record.editorId)
    ) {
      return;
    }
    if (record.payload.length > MAX_PAYLOAD_LENGTH) {
      throw new Error("This draft is too large to keep a recovery copy.");
    }
    const records = readRecords(record).filter(
      (current) =>
        current.editorId !== record.editorId ||
        current.localId !== record.localId
    );
    records.push(record);
    writeRecords(record, records.slice(-MAX_RECORDS_PER_MAILBOX));
  },
  setUser: (userId: string | undefined) => {
    const previousUserId =
      identity.state === "bound" ? identity.userId : undefined;
    identity = { state: "bound", userId };
    if (previousUserId === undefined || previousUserId !== userId) {
      draftRecoveryJournal.clearUser(previousUserId);
    }
  },
};
