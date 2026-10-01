import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, test, vi } from "vite-plus/test";

import { retryIdempotentDatabaseQuery } from "../src/retry";

describe("idempotent database query retry", () => {
  test.each([
    new DrizzleQueryError(
      "update recovery",
      [],
      new Error("Network connection lost.")
    ),
    Object.assign(new Error("Connection closed"), {
      code: "CONNECTION_CLOSED",
    }),
    Object.assign(new Error("Connection reset"), { code: "ECONNRESET" }),
  ])(
    "retries a query after a transient connection failure: %s",
    async (failure) => {
      const run = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue("recovered");

      await expect(retryIdempotentDatabaseQuery(run)).resolves.toBe(
        "recovered"
      );
      expect(run).toHaveBeenCalledTimes(2);
    }
  );

  test("returns a successful query without replaying it", async () => {
    const run = vi.fn<() => Promise<number>>().mockResolvedValue(1);

    await expect(retryIdempotentDatabaseQuery(run)).resolves.toBe(1);
    expect(run).toHaveBeenCalledOnce();
  });

  test.each([
    Object.assign(new Error("Network connection lost."), { code: "23505" }),
    Object.assign(new Error("Client ended"), { code: "CONNECTION_ENDED" }),
    Object.assign(new Error("Client destroyed"), {
      code: "CONNECTION_DESTROYED",
    }),
    Object.assign(new Error("Database overloaded"), { code: "53300" }),
    new Error("Query failed"),
  ])(
    "does not retry query errors or deliberately closed clients: %s",
    async (failure) => {
      const run = vi.fn<() => Promise<never>>().mockRejectedValue(failure);

      await expect(retryIdempotentDatabaseQuery(run)).rejects.toBe(failure);
      expect(run).toHaveBeenCalledOnce();
    }
  );

  test("bounds retries and preserves the original error after an outage", async () => {
    const error = new DrizzleQueryError(
      "select recovery",
      [],
      new Error("Network connection lost.")
    );
    const run = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(retryIdempotentDatabaseQuery(run)).rejects.toBe(error);
    expect(run.mock.calls.length).toBeGreaterThan(1);
    expect(run.mock.calls.length).toBeLessThan(10);
  });

  test("stops retrying when a reconnect reveals a permanent query error", async () => {
    const failure = Object.assign(new Error("Constraint failed"), {
      code: "23505",
    });
    const run = vi
      .fn<() => Promise<never>>()
      .mockRejectedValueOnce(new Error("Network connection lost."))
      .mockRejectedValue(failure);

    await expect(retryIdempotentDatabaseQuery(run)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("terminates when an error has a circular cause", async () => {
    const error = new Error("Query failed");
    error.cause = error;
    const run = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(retryIdempotentDatabaseQuery(run)).rejects.toBe(error);
    expect(run).toHaveBeenCalledOnce();
  });
});
