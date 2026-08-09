export class QuieterApiError extends Error {
  readonly issues?: unknown;
  readonly response?: unknown;
  readonly status: number;

  constructor(input: {
    issues?: unknown;
    message: string;
    response?: unknown;
    status: number;
  }) {
    super(input.message);
    this.name = "QuieterApiError";
    this.issues = input.issues;
    this.response = input.response;
    this.status = input.status;
  }
}
