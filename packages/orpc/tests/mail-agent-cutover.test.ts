import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { describe, expect, test, vi } from "vite-plus/test";

import { getPersonalActionCutoverError } from "../src/mail-agent/cutover";
import { createOrpcHandler } from "../src/server";

const state = vi.hoisted(() => ({ error: new Error("No failure configured") }));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Exercise the real RPC transport with a procedure that fails at the database boundary.
vi.mock("../src/routers/index", async () => {
  const { os } = await import("@orpc/server");
  return {
    appRouter: {
      blocked: os.handler(() => {
        throw state.error;
      }),
    },
  };
});

describe("Action cutover errors", () => {
  test("maps wrapped guard failures to a retryable client error", () => {
    const guard = Object.assign(
      new Error("An update is in progress. Retry shortly."),
      {
        code: "55000",
        constraint_name: "quieter_action_cutover",
      }
    );
    const error = new Error("Database write failed", { cause: guard });
    const mapped = getPersonalActionCutoverError(error);
    expect(mapped).toBeInstanceOf(ORPCError);
    expect(mapped).toMatchObject({ code: "CONFLICT", message: guard.message });
    expect(mapped?.cause).toBe(error);
  });

  test("leaves unrelated database failures unexpected and terminates cyclic causes", () => {
    const unrelated = Object.assign(
      new Error("Different prerequisite failed"),
      {
        code: "55000",
        constraint_name: "another_guard",
      }
    );
    unrelated.cause = unrelated;
    expect(getPersonalActionCutoverError(unrelated)).toBeNull();
    expect(getPersonalActionCutoverError(new Error("Query failed"))).toBeNull();
  });

  test("returns maintenance feedback over RPC without reporting an unexpected failure", async () => {
    const guard = Object.assign(
      new Error("An update is in progress. Retry shortly."),
      {
        code: "55000",
        constraint_name: "quieter_action_cutover",
      }
    );
    state.error = new Error("Database write failed", { cause: guard });
    const reportError = vi.fn<(error: unknown) => void>();
    const result = await createOrpcHandler({ reportError }).handle(
      new Request("https://example.test/api/orpc/blocked", {
        body: JSON.stringify({ json: {} }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { context: { db, headers: new Headers() }, prefix: "/api/orpc" }
    );
    expect(result.matched).toBeTruthy();
    expect(result.response?.status).toBe(409);
    await expect(result.response?.json()).resolves.toMatchObject({
      json: { code: "CONFLICT", message: guard.message },
    });
    expect(reportError).not.toHaveBeenCalled();
  });
});
