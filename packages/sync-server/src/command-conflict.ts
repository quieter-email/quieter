export class SyncCommandConflictError extends Error {
  constructor() {
    super("This action identifier was already used for a different action.");
    this.name = "SyncCommandConflictError";
  }
}
