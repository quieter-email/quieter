export class SyncSubmissionUncertainError extends Error {
  constructor() {
    super(
      "The previous request may have completed. Its outcome must be confirmed before trying again."
    );
    this.name = "SyncSubmissionUncertainError";
  }
}
