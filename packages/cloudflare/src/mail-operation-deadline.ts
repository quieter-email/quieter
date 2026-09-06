export const withMailOperationDeadline = async <T>(
  operation: Promise<T>
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      // oxlint-disable-next-line promise/avoid-new -- Native queue and R2 operations do not accept an abort signal.
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Mail operation deadline exceeded."));
        }, 10_000);
      }),
    ]);
  } catch {
    throw new Error("Mail service operation failed.");
  } finally {
    clearTimeout(timer);
  }
};
