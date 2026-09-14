/**
 * Fire-and-forget a promise whose rejection is non-fatal (storage writes,
 * theme application, native UI calls) without leaving an unhandled rejection.
 */
export const ignoreFailure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch {
    // The caller opted into best-effort behavior.
  }
};
