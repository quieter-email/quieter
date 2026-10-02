// Broadcasts only invalidate caches, so replaying them is safe.
export const retryMailBroadcast = async (
  broadcast: () => Promise<Response>
): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await broadcast();
    } catch (error) {
      if (
        attempt >= 2 ||
        typeof error !== "object" ||
        error === null ||
        !("retryable" in error) ||
        error.retryable !== true ||
        ("overloaded" in error && error.overloaded === true)
      ) {
        throw error;
      }
      await scheduler.wait(100 * 2 ** attempt * (1 + Math.random()));
    }
  }
};
