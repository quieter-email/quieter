export class SyncSubmissionConflictError extends Error {
  constructor() {
    super("This request was already submitted with different content.");
    this.name = "SyncSubmissionConflictError";
  }
}
