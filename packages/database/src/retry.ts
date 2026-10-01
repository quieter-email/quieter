import { setTimeout as sleep } from "node:timers/promises";

const connectionErrorCodes = new Set([
  "CONNECTION_CLOSED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "EPIPE",
]);

// Only use for standalone queries that remain safe if the first attempt committed.
// Postgres.js reconnects on the next query; never replay provider calls or transactions.
export const retryIdempotentDatabaseQuery = async <Result>(
  run: () => Promise<Result>
): Promise<Result> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      let cause: unknown = error;
      const seen = new Set<Error>();
      let connectionLost = false;
      while (cause instanceof Error && !seen.has(cause)) {
        seen.add(cause);
        const code: unknown = Reflect.get(cause, "code");
        if (
          (typeof code === "string" && connectionErrorCodes.has(code)) ||
          (code === undefined && cause.message === "Network connection lost.")
        ) {
          connectionLost = true;
          break;
        }
        const { cause: nextCause } = cause;
        cause = nextCause;
      }
      if (!connectionLost || attempt >= 2) {
        throw error;
      }
      await sleep(100 * 2 ** attempt);
    }
  }
};
