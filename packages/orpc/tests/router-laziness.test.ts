import { isLazy } from "@orpc/server";
import { describe, expect, test } from "vite-plus/test";
import { appRouter } from "../src/routers";

describe("application router", () => {
  test("keeps every feature namespace lazy", () => {
    expect(Object.values(appRouter).every((router) => isLazy(router))).toBe(true);
  });
});
