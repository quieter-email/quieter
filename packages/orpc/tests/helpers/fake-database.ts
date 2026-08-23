type FakeChainStep = () => FakeBuilder;

type FakeBuilder = {
  for: (strength: "update") => FakeBuilder;
  innerJoin: FakeChainStep;
  leftJoin: FakeChainStep;
  limit: FakeChainStep;
  onConflictDoNothing: FakeChainStep;
  orderBy: FakeChainStep;
  returning: FakeChainStep;
  set: FakeChainStep;
  values: FakeChainStep;
  where: FakeChainStep;
  then: (
    onFulfilled?: (value: unknown[]) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => PromiseLike<unknown>;
};

type FakeDatabase = {
  select: () => { from: (table: unknown) => FakeBuilder };
  transaction: <Result>(
    callback: (transaction: FakeDatabase) => Promise<Result>
  ) => Promise<Result>;
  update: (table: unknown) => FakeBuilder;
};

/**
 * Minimal chainable stand-in for the Drizzle client. Awaits resolve rows from
 * a FIFO queue keyed by the table object passed to from()/update(), so tests
 * enqueue results in the exact order the code under test issues its queries.
 */
const selectQueues = new Map<unknown, unknown[][]>();

const shiftRows = (table: unknown): unknown[] => {
  const rows = selectQueues.get(table)?.shift();
  if (rows === undefined) {
    throw new Error("Fake database ran out of queued rows for the query.");
  }
  return rows;
};

const createBuilder = (table: unknown): FakeBuilder => {
  let evaluatedRows: unknown[] | null = null;
  const evaluate = (): unknown[] => {
    evaluatedRows ??= shiftRows(table);
    return evaluatedRows;
  };
  const builder: FakeBuilder = {
    for: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    limit: () => builder,
    onConflictDoNothing: () => builder,
    orderBy: () => builder,
    returning: () => builder,
    set: () => builder,
    // Drizzle query builders are awaited thenables; the fake mirrors that contract.
    // oxlint-disable-next-line unicorn/no-thenable
    async then(onFulfilled, onRejected) {
      try {
        return await onFulfilled?.(evaluate());
      } catch (error) {
        if (onRejected === undefined) {
          throw error;
        }
        return await onRejected(error);
      }
    },
    values: () => builder,
    where: () => builder,
  };
  return builder;
};

export const createFakeDatabaseModule = () => {
  const fakeDatabase: FakeDatabase = {
    select: () => ({ from: (table: unknown) => createBuilder(table) }),
    // oxlint-disable promise/prefer-await-to-callbacks -- Mirrors Drizzle's transaction callback API.
    transaction: async <Result>(
      callback: (transaction: FakeDatabase) => Promise<Result>
    ) => await callback(fakeDatabase),
    // oxlint-enable promise/prefer-await-to-callbacks
    update: (table: unknown) => createBuilder(table),
  };
  return { db: fakeDatabase };
};

export const queueRows = (table: unknown, rows: unknown[]) => {
  const queue = selectQueues.get(table) ?? [];
  queue.push(rows);
  selectQueues.set(table, queue);
};

export const resetQueues = () => {
  selectQueues.clear();
};
