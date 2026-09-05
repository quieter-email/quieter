export class LimitedJsonRequestError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LimitedJsonRequestError";
    this.status = status;
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
    throw new LimitedJsonRequestError(413, "Chat request body too large.");
  }

  if (request.body === null) {
    throw new LimitedJsonRequestError(400, "Invalid chat request body.");
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
        throw new LimitedJsonRequestError(413, "Chat request body too large.");
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
    throw new LimitedJsonRequestError(400, "Invalid chat request body.", {
      cause: error,
    });
  }
};
