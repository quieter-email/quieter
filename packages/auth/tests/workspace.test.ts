import { describe, expect, test } from "bun:test";
import { PERSONAL_WORKSPACE_ID } from "../src/workspace";

describe("workspace constants", () => {
  test("keeps Personal as a synthetic workspace id", () => {
    expect(PERSONAL_WORKSPACE_ID).toBe("personal");
  });
});
