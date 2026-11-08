import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { runSupermemoryComparison } from "../evals/supermemory-comparison";

describe("synthetic comparison destination isolation", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([
    "https://api.supermemory.ai/",
    // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- The rejected target verifies that no credential is sent.
    "http://localhost.example.invalid/",
    "http://127.0.0.1/proxy",
    "http://127.0.0.1/?target=external",
    "http://user@127.0.0.1/",
    "file:///tmp/memory",
  ])("rejects %s before sending any credential or corpus", async (baseUrl) => {
    const request = vi.spyOn(globalThis, "fetch");
    await expect(
      runSupermemoryComparison({
        apiKey: "synthetic-local-test",
        baseUrl,
        embeddingModel: "synthetic-embedding",
        extractionModel: "synthetic-extractor",
        pause: async () => {
          await Promise.resolve();
        },
        scenarioIds: [],
        serviceVersion: "synthetic-server",
        taskType: "superrag",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(request).not.toHaveBeenCalled();
  });

  test("resuming rejects a changed corpus without adding documents", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        await Promise.resolve();
        return Response.json({
          content: "A different retained fact.",
          id: "retained",
          system: { status: "done" },
        });
      });
    await expect(
      runSupermemoryComparison({
        apiKey: "synthetic-local-test",
        baseUrl: "http://127.0.0.1:6767/",
        embeddingModel: "synthetic-embedding",
        extractionModel: "synthetic-extractor",
        pause: async () => {
          await Promise.resolve();
        },
        resumeRunId: "eeaab2ad-847a-4bdc-9638-20c1cc94c3d1",
        scenarioIds: ["recipient-and-general-voice"],
        serviceVersion: "synthetic-server",
        taskType: "memory",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(
      request.mock.calls.every(([, input]) => input?.method === "GET")
    ).toBeTruthy();
  });
});
