import { RequestError } from "./request-error";

export const readBoundedJson = async (request: Request, limit: number) => {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new RequestError(413, "request_body_too_large");
  }
  if (request.body === null) {
    throw new RequestError(400, "request_body_missing");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];

  let length = 0;
  try {
    while (true) {
      // Request chunks must be consumed serially to enforce the byte limit.
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array)) {
        continue;
      }
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RequestError(413, "request_body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new RequestError(400, "request_json_invalid");
  }
};
