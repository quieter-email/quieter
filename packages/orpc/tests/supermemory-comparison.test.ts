import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { memoryRecallScenarios } from "../evals/memory-recall-scenarios";
import { runSupermemoryComparison } from "../evals/supermemory-comparison";

const voiceScenario = memoryRecallScenarios.find(
  (scenario) => scenario.id === "recipient-and-general-voice"
);
if (!voiceScenario) {
  throw new Error("Shared recipient scenario is missing.");
}
const mockReadOnlyLocalCorpus = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : input);
    if (options?.method === "GET") {
      const id = url.pathname.split("/").at(-1);
      const fact = voiceScenario.facts.find((entry) => entry.key === id);
      if (!fact) {
        throw new Error("Unexpected source document read.");
      }
      return Response.json({
        content: fact.content,
        id: fact.key,
        system: { status: "done" },
      });
    }
    if (url.pathname.endsWith("/list/memories")) {
      return Response.json({ memories: [] });
    }
    if (url.pathname.endsWith("/profile")) {
      return Response.json({ profile: { dynamic: [], static: [] } });
    }
    if (url.pathname.endsWith("/search")) {
      return Response.json({
        results: [
          {
            chunk: "Concise warm replies",
            id: "source-chunk",
            metadata: { concept: "voice" },
          },
        ],
      });
    }
    throw new Error("A resumed comparison must not ingest documents.");
  });
const resumedOptions = {
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
  taskType: "superrag" as const,
};

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

  test("pairs the SQL case metrics and configuration through a resumed local comparison", async () => {
    mockReadOnlyLocalCorpus();
    const report = await runSupermemoryComparison({
      ...resumedOptions,
      quieterReport: {
        cases: [
          {
            forbidden: [],
            id: "recipient-and-general-voice",
            kind: "contract",
            matched: ["voice"],
            missing: ["alex"],
            returnedCharacters: 54,
            status: "fail",
          },
        ],
        configuredExpansionModel: "controlled-expander",
        layer: "canonical-sql-recall",
        mode: "semantic-live",
        status: "complete",
      },
    });
    expect(report.quieterBaseline).toMatchObject({
      configuredExpansionModel: "controlled-expander",
      mode: "semantic-live",
    });
    expect(report.cases[0]).toMatchObject({
      id: "recipient-and-general-voice",
      quieter: {
        result: {
          matched: ["voice"],
          missing: ["alex"],
          returnedCharacters: 54,
          status: "fail",
        },
        status: "paired-by-scenario-id",
      },
    });
  });

  test.each([
    { expected: "missing", layer: "canonical-sql-recall" },
    { expected: "incomparable", layer: "selector-only" },
  ])(
    "marks an unavailable or incompatible SQL counterpart as $expected",
    async ({ layer, expected }) => {
      mockReadOnlyLocalCorpus();
      const report = await runSupermemoryComparison({
        ...resumedOptions,
        quieterReport: { cases: [], layer, status: "complete" },
      });
      expect(report.cases[0]?.quieter).toMatchObject({ status: expected });
    }
  );
});
