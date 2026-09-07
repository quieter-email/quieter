export class LimitedJsonRequestError extends Error {
  readonly status: 400 | 413;
  readonly kind: "too_large" | "invalid_encoding" | "invalid_json";

  constructor(kind: LimitedJsonRequestError["kind"], options?: ErrorOptions) {
    super(
      kind === "too_large"
        ? "Request body too large."
        : "Invalid JSON request body.",
      options
    );
    this.name = "LimitedJsonRequestError";
    this.kind = kind;
    this.status = kind === "too_large" ? 413 : 400;
  }
}

export const readLimitedJsonRequest = async (
  request: Request,
  maxBytes: number
): Promise<unknown> => {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maxBytes
  ) {
    throw new LimitedJsonRequestError("too_large");
  }

  if (request.body === null) {
    throw new LimitedJsonRequestError("invalid_json");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      // A request stream must be read serially; parallel reads are invalid.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        throw new LimitedJsonRequestError("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  try {
    for (const chunk of chunks) {
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new LimitedJsonRequestError(
      error instanceof SyntaxError ? "invalid_json" : "invalid_encoding",
      {
        cause: error,
      }
    );
  }
};
