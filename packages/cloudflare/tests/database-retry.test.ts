import { retryIdempotentDatabaseQuery } from "@quieter/database/retry";
import { describe, expect, test, vi } from "vite-plus/test";

describe("Worker database query retry", () => {
  test("waits and retries a Worker socket failure", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error("Database query failed.", {
          cause: new Error("Network connection lost."),
        })
      )
      .mockResolvedValue("recovered");

    await expect(retryIdempotentDatabaseQuery(run)).resolves.toBe("recovered");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
