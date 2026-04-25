import { describe, expect, test } from "bun:test";
import {
  PERSONAL_WORKSPACE_ID,
  isPersonalWorkspaceId,
  toOrganizationId,
  toWorkspaceId,
} from "../src/workspace";

describe("workspace conversion", () => {
  test("maps null active org to Personal", () => {
    expect(toWorkspaceId(null)).toBe(PERSONAL_WORKSPACE_ID);
  });

  test("maps org id to the same workspace id", () => {
    expect(toWorkspaceId("org_123")).toBe("org_123");
  });

  test("maps Personal back to null", () => {
    expect(toOrganizationId(PERSONAL_WORKSPACE_ID)).toBeNull();
    expect(isPersonalWorkspaceId(PERSONAL_WORKSPACE_ID)).toBe(true);
  });

  test("maps org workspace id back to that org id", () => {
    expect(toOrganizationId("org_123")).toBe("org_123");
  });
});
