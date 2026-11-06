import type * as ReservationModule from "@quieter/billing/ai-reservation";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import type { AiUsageReport } from "../src/chat-usage";
import {
  embedSearchTexts,
  SEARCH_EMBEDDING_DIMENSIONS,
  SEARCH_EMBEDDING_MODEL,
} from "../src/search-embeddings";

const state = vi.hoisted(() => ({
  generation:
    vi.fn<typeof ReservationModule.recordAiCreditProviderGeneration>(),
  release: vi.fn<typeof ReservationModule.releaseAiCreditUsage>(),
  reserve: vi.fn<typeof ReservationModule.reserveAiCreditUsage>(),
  settle: vi.fn<typeof ReservationModule.settleAiCreditUsage>(),
}));
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  recordAiCreditProviderGeneration: state.generation,
  releaseAiCreditUsage: state.release,
  reserveAiCreditUsage: state.reserve,
  settleAiCreditUsage: state.settle,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, OPENROUTER_API_KEY: "fixture-key" },
  };
});

const reservationId = crypto.randomUUID();
const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "embedding-fixture",
  kind: "team",
  organizationId: "fixture-team",
  usageKind: "aiMemory",
};

const providerResponse = () => ({
  data: [
    {
      embedding: Array.from(
        { length: SEARCH_EMBEDDING_DIMENSIONS },
        (_, index): number => (index === 0 ? 0.5 : 0)
      ),
      index: 0,
    },
  ],
  id: "synthetic-generation",
  model: SEARCH_EMBEDDING_MODEL,
  usage: { cost: 0.00001, prompt_tokens: 8 },
});

describe("search embedding provider boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.reserve.mockResolvedValue(reservationId);
    state.settle.mockResolvedValue(void 0);
    state.release.mockResolvedValue(void 0);
  });
  afterEach(() => vi.unstubAllGlobals());

  test("accepts the provider's unqualified identity for the selected model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          ...providerResponse(),
          model: "text-embedding-3-small",
        })
      )
    );
    const vectors = await embedSearchTexts({
      billing,
      values: ["Synthetic text"],
    });
    expect(vectors).toHaveLength(1);
  });

  test("settles usage and preserves input correspondence for reordered vectors", async () => {
    const response = providerResponse();
    const [first] = response.data;
    const second = {
      embedding: first.embedding.map((value) => -value),
      index: 1,
    };
    response.data = [second, first];
    const fetchProvider = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchProvider);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    const vectors = await embedSearchTexts({
      billing,
      onUsage,
      values: ["Flight preferences", "A different topic"],
    });
    expect(vectors.map((vector) => vector.at(0))).toStrictEqual([0.5, -0.5]);
    expect(state.settle).toHaveBeenCalledWith({
      costUsd: response.usage.cost,
      reservationId,
    });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: response.usage.cost,
        promptTokens: response.usage.prompt_tokens,
      })
    );
    const request = z
      .object({
        dimensions: z.number(),
        encoding_format: z.string(),
        provider: z.object({
          require_parameters: z.boolean(),
          zdr: z.boolean(),
        }),
      })
      .parse(
        JSON.parse(z.string().parse(fetchProvider.mock.calls[0]?.[1]?.body))
      );
    expect(request).toMatchObject({
      dimensions: 1024,
      encoding_format: "float",
      provider: { require_parameters: true, zdr: true },
    });
  });

  test.each([
    { values: [] },
    { values: [""] },
    { values: [" "] },
    { values: ["x".repeat(100_000)] },
  ])(
    "invalid input never reserves credits or reaches the provider",
    async ({ values }) => {
      const fetchProvider = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchProvider);
      await expect(embedSearchTexts({ billing, values })).rejects.toThrow(
        /supported request limits/u
      );
      expect(state.reserve).not.toHaveBeenCalled();
      expect(fetchProvider).not.toHaveBeenCalled();
    }
  );

  test("a cancelled or unadmitted operation never reaches the provider", async () => {
    const fetchProvider = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchProvider);
    await expect(
      embedSearchTexts({
        billing,
        signal: AbortSignal.abort(),
        values: ["Synthetic text"],
      })
    ).rejects.toThrow(/abort/iu);
    expect(state.reserve).not.toHaveBeenCalled();
    state.reserve.mockRejectedValue(new Error("Unavailable balance"));
    await expect(
      embedSearchTexts({ billing, values: ["Synthetic text"] })
    ).rejects.toThrow(/Unavailable balance/u);
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  test.each([
    { data: [] },
    { data: [{ embedding: [0.5], index: 0 }] },
    {
      data: [
        {
          embedding: Array.from(
            { length: SEARCH_EMBEDDING_DIMENSIONS },
            () => 0
          ),
          index: 0,
        },
      ],
    },
    { model: "incompatible-vector-space" },
    {
      data: [
        {
          embedding: Array.from(
            { length: SEARCH_EMBEDDING_DIMENSIONS },
            () => 0.5
          ),
          index: 1,
        },
      ],
    },
  ])(
    "rejects incompatible vectors after settling their known cost",
    async (invalid) => {
      const response = { ...providerResponse(), ...invalid };
      const fetchProvider = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(response));
      vi.stubGlobal("fetch", fetchProvider);
      await expect(
        embedSearchTexts({ billing, values: ["Synthetic text"] })
      ).rejects.toThrow(/invalid response/u);
      expect(state.settle).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: response.usage.cost })
      );
      expect(state.release).not.toHaveBeenCalled();
    }
  );

  test("duplicate indices and nonfinite vectors cannot become search records", async () => {
    const duplicate = providerResponse();
    const [first] = duplicate.data;
    duplicate.data.push(first);
    const fetchProvider = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(duplicate));
    vi.stubGlobal("fetch", fetchProvider);
    await expect(
      embedSearchTexts({ billing, values: ["One topic", "Another topic"] })
    ).rejects.toThrow(/invalid response/u);
    const nonfinite = providerResponse();
    const [invalid] = nonfinite.data;
    invalid.embedding[0] = Number.POSITIVE_INFINITY;
    const nonfiniteResponse = new Response();
    vi.spyOn(nonfiniteResponse, "json").mockResolvedValue(nonfinite);
    fetchProvider.mockResolvedValueOnce(nonfiniteResponse);
    await expect(
      embedSearchTexts({ billing, values: ["Synthetic text"] })
    ).rejects.toThrow(/invalid response/u);
  });

  test("missing cost leaves the reservation held and reports no successful result", async () => {
    const response = providerResponse();
    const fetchProvider = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ...response, usage: { prompt_tokens: 8 } })
      );
    vi.stubGlobal("fetch", fetchProvider);
    await expect(
      embedSearchTexts({ billing, values: ["Synthetic text"] })
    ).rejects.toThrow(/did not report/u);
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.release).not.toHaveBeenCalled();
  });

  test("settles known cost even when generation metadata is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ ...providerResponse(), id: null }))
    );
    await expect(
      embedSearchTexts({ billing, values: ["Synthetic text"] })
    ).resolves.toHaveLength(1);
    expect(state.settle).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: providerResponse().usage.cost })
    );
  });

  test("preserves the generation identifier when usage metadata is malformed", async () => {
    const response = providerResponse();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ ...response, usage: { cost: "invalid" } })
        )
    );
    await expect(
      embedSearchTexts({ billing, values: ["Synthetic text"] })
    ).rejects.toThrow(/did not report/u);
    expect(state.generation).toHaveBeenCalledWith({
      generationId: response.id,
      reservationId,
    });
    expect(state.release).not.toHaveBeenCalled();
  });

  test("confirmed rejection releases credits without retaining provider details", async () => {
    const fetchProvider = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: "private echoed text" }, { status: 429 })
      );
    vi.stubGlobal("fetch", fetchProvider);
    const request = embedSearchTexts({ billing, values: ["Private query"] });
    await expect(request).rejects.toThrow(/temporarily unavailable/u);
    await expect(request).rejects.not.toThrow(
      /Private query|private echoed text/u
    );
    expect(state.release).toHaveBeenCalledOnce();
    expect(state.settle).not.toHaveBeenCalled();
    expect(fetchProvider).toHaveBeenCalledOnce();
  });

  test("uncertain network failure preserves the hold without an automatic retry", async () => {
    const fetchProvider = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Connection lost"));
    vi.stubGlobal("fetch", fetchProvider);
    await expect(
      embedSearchTexts({ billing, values: ["Synthetic text"] })
    ).rejects.toThrow(/Connection lost/u);
    expect(state.release).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
    expect(fetchProvider).toHaveBeenCalledOnce();
  });
});
