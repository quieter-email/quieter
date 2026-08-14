const toAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException("Aborted", "AbortError");
};

/** Abortable delay without constructing a manual Promise wrapper. */
export const delay = async (
  ms: number,
  signal?: AbortSignal
): Promise<void> => {
  if (ms <= 0) {
    if (signal !== undefined && signal.aborted) {
      throw toAbortError(signal.reason);
    }
    return;
  }

  if (signal !== undefined && signal.aborted) {
    throw toAbortError(signal.reason);
  }

  const timeoutSignal = AbortSignal.timeout(ms);
  const abortSignal =
    signal === undefined
      ? timeoutSignal
      : AbortSignal.any([signal, timeoutSignal]);

  try {
    await fetch("data:text/plain,", { signal: abortSignal });
  } catch (error) {
    if (signal !== undefined && signal.aborted) {
      throw toAbortError(signal.reason);
    }
    throw error;
  }
};

/** Run async work in the background; errors are swallowed. */
export const scheduleFireAndForget = (task: () => Promise<void>): void => {
  const run = async (): Promise<void> => {
    try {
      await task();
    } catch {
      await delay(0);
    }
  };
  void run();
};
