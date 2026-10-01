import { describe, expect, test, vi } from "vite-plus/test";

import { retryMailBroadcast } from "../src/retry-mail-broadcast";

describe("mail broadcast recovery", () => {
  test("recovers from a retryable platform failure", async () => {
    const broadcast = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("internal error"), { retryable: true })
      )
      .mockResolvedValue(new Response(null, { status: 204 }));

    const response = await retryMailBroadcast(broadcast);

    expect(response.status).toBe(204);
    expect(broadcast.mock.calls.length).toBeGreaterThan(1);
  });

  test.each([
    new Error("application failure"),
    Object.assign(new Error("overloaded"), {
      overloaded: true,
      retryable: true,
    }),
  ])("propagates failures that must not be retried", async (failure) => {
    const broadcast = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValue(failure);

    await expect(retryMailBroadcast(broadcast)).rejects.toBe(failure);

    expect(broadcast).toHaveBeenCalledOnce();
  });

  test("stops retrying persistent platform failures", async () => {
    const error = Object.assign(new Error("internal error"), {
      retryable: true,
    });
    const broadcast = vi.fn<() => Promise<Response>>().mockRejectedValue(error);

    await expect(retryMailBroadcast(broadcast)).rejects.toBe(error);

    expect(broadcast.mock.calls.length).toBeGreaterThan(1);
    expect(broadcast.mock.calls.length).toBeLessThan(10);
  });
});
