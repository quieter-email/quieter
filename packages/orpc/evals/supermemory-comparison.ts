import { z } from "zod";

import { memoryRecallScenarios } from "./memory-recall-scenarios.ts";

const metadataSchema = z.object({ concept: z.string().optional() });
const documentSchema = z.object({
  content: z.string().optional(),
  id: z.string(),
  metadata: metadataSchema.optional(),
  system: z.object({ status: z.string().optional() }).optional(),
});
const memorySchema = z.object({
  id: z.string(),
  memory: z.string(),
  metadata: metadataSchema.optional(),
});
const searchSchema = z.object({
  results: z.array(
    z.object({
      chunk: z.string().optional(),
      id: z.string(),
      included: z.object({ document: documentSchema.optional() }).optional(),
      memory: z.string().optional(),
      metadata: metadataSchema.optional(),
    })
  ),
});
const profileSchema = z.object({
  profile: z.object({
    dynamic: z.array(memorySchema),
    static: z.array(memorySchema),
  }),
});
const listSchema = z.object({ memories: z.array(memorySchema) });
const quieterCaseSchema = z.object({
  forbidden: z.array(z.string()).optional(),
  id: z.string(),
  kind: z.string().optional(),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  returnedCharacters: z.number(),
  status: z.string(),
});
const quieterReportSchema = z.object({
  cases: z.array(quieterCaseSchema),
  configuredExpansionModel: z.string().nullable().optional(),
  layer: z.string(),
  mode: z.string().optional(),
  status: z.literal("complete"),
});
type QuieterPairing =
  | { status: "not-provided" }
  | { status: "missing" }
  | { result: z.infer<typeof quieterCaseSchema> | null; status: "incomparable" }
  | {
      result: z.infer<typeof quieterCaseSchema>;
      status: "paired-by-scenario-id";
    };

export const runSupermemoryComparison = async ({
  apiKey,
  baseUrl,
  embeddingModel,
  extractionModel,
  serviceVersion,
  pause,
  taskType,
  scenarioIds,
  quieterReport,
  resumeRunId,
}: {
  apiKey: string;
  baseUrl: string;
  embeddingModel: string;
  extractionModel: string;
  serviceVersion: string;
  pause: (milliseconds: number) => Promise<void>;
  taskType: "memory" | "superrag";
  scenarioIds: string[];
  quieterReport?: unknown;
  resumeRunId?: string;
}) => {
  const baseline =
    quieterReport === undefined
      ? undefined
      : quieterReportSchema.parse(quieterReport);
  const base = new URL(baseUrl);
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  ) {
    throw new Error(
      "Comparison accepts only an explicit loopback HTTP server root."
    );
  }
  const request = async <T>(
    pathname: string,
    schema: z.ZodType<T>,
    body?: object
  ) => {
    const response = await fetch(new URL(pathname, base), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(
        `Local memory request failed with HTTP ${response.status}.`
      );
    }
    const result: unknown = await response.json();
    return schema.parse(result);
  };
  const runId = resumeRunId ?? crypto.randomUUID();
  const scenarios = memoryRecallScenarios.filter(
    (scenario) =>
      (scenario.kind === "quality-probe" ||
        scenario.id === "recipient-and-general-voice") &&
      (scenarioIds.length === 0 || scenarioIds.includes(scenario.id))
  );
  if (
    scenarioIds.some((id) => !scenarios.some((scenario) => scenario.id === id))
  ) {
    throw new Error(
      "Select only shared semantic probes or the recipient voice scenario."
    );
  }
  const cases = [];
  for (const scenario of scenarios) {
    const namespace = `quieter_eval_${runId}_${scenario.id}`.replaceAll(
      "-",
      "_"
    );
    if (resumeRunId === undefined) {
      for (const fact of scenario.facts) {
        await request(
          `/ns/${namespace}/document`,
          z.object({ id: z.string() }),
          {
            content: fact.content,
            dreaming: "instant",
            id: fact.key,
            metadata: { concept: fact.key },
            taskType,
          }
        );
      }
    }
    const deadline = Date.now() + 600_000;
    let documentsReady = false;
    while (!documentsReady && Date.now() < deadline) {
      const statuses = await Promise.all(
        scenario.facts.map(
          async (fact) =>
            await request(
              `/ns/${namespace}/document/${fact.key}`,
              documentSchema
            )
        )
      );
      if (
        statuses.some(
          (document, index) =>
            document.content !== scenario.facts[index]?.content
        )
      ) {
        throw new Error(
          "Stored comparison corpus differs from the shared scenario."
        );
      }
      if (statuses.some((document) => document.system?.status === "failed")) {
        throw new Error(
          `Local document processing failed for scenario ${scenario.id}.`
        );
      }
      documentsReady = statuses.every(
        (document) => document.system?.status === "done"
      );
      if (!documentsReady) {
        await pause(1000);
      }
    }
    if (!documentsReady) {
      throw new Error(
        `Local document processing timed out for scenario ${scenario.id}.`
      );
    }
    let listed = await request(
      `/ns/${namespace}/list/memories?limit=100`,
      listSchema,
      {}
    );
    let previousCount = -1;
    let stableCount = 0;
    const memoryDeadline = Date.now() + 180_000;
    if (taskType === "memory") {
      while (stableCount < 5 && Date.now() < memoryDeadline) {
        await pause(2000);
        listed = await request(
          `/ns/${namespace}/list/memories?limit=100`,
          listSchema,
          {}
        );
        stableCount =
          listed.memories.length > 0 && listed.memories.length === previousCount
            ? stableCount + 1
            : 0;
        previousCount = listed.memories.length;
      }
    }
    const listedConcepts = new Map(
      listed.memories.map((memory) => [memory.id, memory.metadata?.concept])
    );
    const profile = await request(
      `/ns/${namespace}/profile`,
      profileSchema,
      {}
    );
    const lanes = [];
    for (const mode of ["chunks", "memories"] as const) {
      const response = await request(`/ns/${namespace}/search`, searchSchema, {
        include: { documents: true },
        limit: 10,
        query: scenario.query,
        searchMode: mode,
      });
      const entries = response.results.map((result) => ({
        concept:
          result.metadata?.concept ??
          result.included?.document?.metadata?.concept,
        id: result.id,
        text: result.chunk ?? result.memory ?? "",
      }));
      lanes.push({ entries, mode });
    }
    lanes.push({
      entries: [...profile.profile.static, ...profile.profile.dynamic].map(
        (memory) => ({
          concept: listedConcepts.get(memory.id),
          id: memory.id,
          text: memory.memory,
        })
      ),
      mode: "profile" as const,
    });
    let quieter: QuieterPairing = { status: "not-provided" };
    if (baseline !== undefined) {
      const result = baseline.cases.find((entry) => entry.id === scenario.id);
      if (baseline.layer !== "canonical-sql-recall") {
        quieter = { result: result ?? null, status: "incomparable" };
      } else if (result === undefined) {
        quieter = { status: "missing" };
      } else {
        quieter = { result, status: "paired-by-scenario-id" };
      }
    }
    cases.push({
      corpus: scenario.facts.map((fact) => ({
        concept: fact.key,
        text: fact.content,
      })),
      id: scenario.id,
      lanes: lanes.map(({ entries, mode }) => {
        let characters = 0;
        const selected = entries.filter((entry) => {
          const size = JSON.stringify(entry).length + 1;
          if (characters + size > 32_000) {
            return false;
          }
          characters += size;
          return true;
        });
        const matched = [
          ...new Set(
            selected.flatMap((entry) => (entry.concept ? [entry.concept] : []))
          ),
        ];
        const absentStatus = mode === "chunks" ? "miss" : "indeterminate";
        const unresolved = scenario.relevant.filter(
          (key) => !matched.includes(key)
        );
        let status = unresolved.length === 0 ? "hit" : absentStatus;
        if (mode !== "chunks" && taskType === "superrag") {
          status = "not-evaluated";
        }
        return {
          entries: selected,
          matched,
          mode,
          relevant: scenario.relevant,
          returnedCharacters: characters,
          status,
          unmappedEntries: selected.filter(
            (entry) => entry.concept === undefined
          ).length,
          unresolved,
        };
      }),
      memoryObservation: {
        completion: "not-proven-by-document-done-or-count-stability",
        count: listed.memories.length,
        stablePolls: stableCount,
      },
      namespace,
      query: scenario.query,
      quieter,
      taskType,
    });
  }
  return {
    cases,
    comparisonScope: "source-concept-coverage-on-shared-synthetic-corpus",
    configuration: {
      embeddingModel,
      extractionModel,
      limit: 10,
      memoryCharacterBudget: 32_000,
      service: "supermemory-local",
      serviceVersion,
    },
    limitations: [
      "Source-concept coverage uses document lineage and metadata, not an answer-quality judgment.",
      "Per-fact document ingestion preserves retrieval granularity; extracted memories can merge or paraphrase facts.",
      "A stable nonempty memory count is an observation, not proof every extraction job completed; absent memory/profile hits remain indeterminate.",
      "The local service and configured extractor differ from the hosted proprietary extraction service.",
      "No actor authorization, mailbox isolation, deletion, latency, token, cost, or final-answer comparison is scored.",
      "The character cap bounds returned records; it does not equalize tokenizer counts or provider retrieval effort.",
      "Quieter cases pair by shared scenario ID. Reports without a corpus digest cannot independently prove corpus identity.",
    ],
    quieterBaseline: baseline
      ? {
          configuredExpansionModel: baseline.configuredExpansionModel ?? null,
          layer: baseline.layer,
          mode: baseline.mode ?? "unspecified",
          status: baseline.status,
        }
      : { status: "not-provided" },
    runId,
    status: "complete",
    taskType,
    version: 1,
  };
};
