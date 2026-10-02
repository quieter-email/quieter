import { reportWorkerError } from "./worker-runtime";

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

export const requestErrorResponse = (error: unknown, route: string) => {
  const status = error instanceof RequestError ? error.status : 500;
  const category =
    error instanceof RequestError ? error.category : "internal_error";
  if (status >= 500) {
    reportWorkerError(error, { category, route, status });
  }
  return Response.json({ error: "Request failed" }, { status });
};
