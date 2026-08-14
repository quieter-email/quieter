export type RequestErrorStatus = 400 | 401 | 403 | 413 | 503;

export class RequestError extends Error {
  readonly status: RequestErrorStatus;
  readonly category: string;

  constructor(status: RequestErrorStatus, category: string) {
    super(category);
    this.name = "RequestError";
    this.status = status;
    this.category = category;
  }
}
