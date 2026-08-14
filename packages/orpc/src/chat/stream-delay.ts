import { setTimeout as sleep } from "node:timers/promises";

const toAbortError = (signal?: AbortSignal): Error => {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  return new DOMException("Aborted", "AbortError");
};

export const isAborted = (signal: AbortSignal | undefined) =>
  signal?.aborted === true;

export const delay = async (
  ms: number,
  signal?: AbortSignal
): Promise<void> => {
  if (isAborted(signal)) {
    throw toAbortError(signal);
  }

  if (signal === undefined) {
    await sleep(ms);
    return;
  }

  const abortWait = Promise.withResolvers<undefined>();
  const onAbort = () => {
    abortWait.reject(toAbortError(signal));
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    await Promise.race([sleep(ms), abortWait.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

export const createQueueWaiter = () => {
  let pending: ReturnType<typeof Promise.withResolvers<undefined>> | undefined;

  return {
    reject: (error: unknown) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      pending?.reject(reason);
      pending = undefined;
    },
    wait: async () => {
      pending = Promise.withResolvers<undefined>();
      await pending.promise;
    },
    wake: () => {
      pending?.resolve();
      pending = undefined;
    },
  };
};
