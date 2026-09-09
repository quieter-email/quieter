export const requestResult = async (
  request: EventTarget & {
    readonly result: unknown;
    readonly error: DOMException | null;
  }
): Promise<unknown> => {
  const deferred = Promise.withResolvers<unknown>();
  request.addEventListener(
    "success",
    () => {
      deferred.resolve(request.result);
    },
    {
      once: true,
    }
  );
  request.addEventListener(
    "error",
    () => {
      deferred.reject(request.error ?? new Error("Local storage failed."));
    },
    { once: true }
  );
  return await deferred.promise;
};

export const runTransaction = async <Result>(
  database: IDBDatabase,
  names: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<Result>
): Promise<Result> => {
  const transaction = database.transaction(names, mode);
  const complete = Promise.withResolvers<boolean>();
  transaction.addEventListener(
    "complete",
    () => {
      complete.resolve(true);
    },
    {
      once: true,
    }
  );
  transaction.addEventListener(
    "abort",
    () => {
      complete.reject(
        transaction.error ??
          new Error("Local storage transaction was interrupted.")
      );
    },
    { once: true }
  );
  transaction.addEventListener(
    "error",
    () => {
      complete.reject(transaction.error ?? new Error("Local storage failed."));
    },
    { once: true }
  );
  try {
    const [result] = await Promise.all([run(transaction), complete.promise]);
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch (abortError) {
      if (
        !(
          abortError instanceof DOMException &&
          abortError.name === "InvalidStateError"
        )
      ) {
        throw abortError;
      }
    }
    throw error;
  }
};
