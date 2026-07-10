import { describe, expect, test } from "vite-plus/test";
import { createDefaultOrganizationName } from "../src/organization";

describe("default organization names", () => {
  test("normalizes the user name and adds a stable short id", () => {
    expect(
      createDefaultOrganizationName({
        email: "lea@example.com",
        id: "user-123",
        name: "Léa van Doe",
      }),
    ).toMatch(/^lea-van-doe-[a-f0-9]{6}$/);
  });

  test("uses a team fallback when the name has no slug characters", () => {
    expect(
      createDefaultOrganizationName({
        email: "user@example.com",
        id: "user-456",
        name: "東京",
      }),
    ).toMatch(/^team-[a-f0-9]{6}$/);
  });
});
