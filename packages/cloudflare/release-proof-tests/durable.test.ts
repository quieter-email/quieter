import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

import worker from "../../deployment/src/release-durable-probe.ts";

const request = (method: "GET" | "POST") =>
  new Request("https://fixture.invalid/", {
    headers: {
      authorization: "Bearer test-only-release-proof-token-000000000000",
    },
    method,
  });
describe("native release Durable Object", () => {
  test("retains increments across concurrent requests", async () => {
    const before = await worker.fetch(request("GET"), env);
    await expect(before.json()).resolves.toMatchObject({
      count: 0,
      generation: "baseline",
    });
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const response = await worker.fetch(request("POST"), env);
        expect(response.status).toBe(200);
      })
    );
    const after = await worker.fetch(request("GET"), env);
    await expect(after.json()).resolves.toMatchObject({
      count: 5,
      generation: "baseline",
      versionId: "00000000-0000-4000-8000-000000000269",
    });
    const denied = await worker.fetch(
      new Request("https://fixture.invalid/", { method: "POST" }),
      env
    );
    expect(denied.status).toBe(404);
    const unchanged = await worker.fetch(request("GET"), env);
    await expect(unchanged.json()).resolves.toMatchObject({ count: 5 });
  });
});
