export type LocalDraftRecord = {
  editorId: string;
  localId: string;
  mailboxId: string;
  payload: string;
  updatedAt: number;
};

const STORAGE_KEY_PREFIX = "quieter:draft-recovery:";
const MAX_RECORDS_PER_MAILBOX = 3;
const MAX_PAYLOAD_LENGTH = 4 * 1024 * 1024;

const isRecord = (value: unknown): value is LocalDraftRecord =>
  typeof value === "object" &&
  value !== null &&
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

const storageKey = (mailboxId: string) => `${STORAGE_KEY_PREFIX}${mailboxId}`;

const readRecords = (mailboxId: string): LocalDraftRecord[] => {
  try {
    const raw = localStorage.getItem(storageKey(mailboxId));
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
};

const writeRecords = (mailboxId: string, records: LocalDraftRecord[]) => {
  const key = storageKey(mailboxId);
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
  list: (mailboxId: string): LocalDraftRecord[] =>
    readRecords(mailboxId).toSorted(
      (left, right) => right.updatedAt - left.updatedAt
    ),
  remove: (
    record: Pick<LocalDraftRecord, "editorId" | "localId" | "mailboxId">
  ) => {
    writeRecords(
      record.mailboxId,
      readRecords(record.mailboxId).filter(
        (current) =>
          current.editorId !== record.editorId ||
          current.localId !== record.localId
      )
    );
  },
  save: (record: LocalDraftRecord) => {
    if (record.payload.length > MAX_PAYLOAD_LENGTH) {
      throw new Error("This draft is too large to keep a recovery copy.");
    }
    const records = readRecords(record.mailboxId).filter(
      (current) =>
        current.editorId !== record.editorId ||
        current.localId !== record.localId
    );
    records.push(record);
    writeRecords(record.mailboxId, records.slice(-MAX_RECORDS_PER_MAILBOX));
  },
};
