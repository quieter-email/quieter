import { describe, expect, test } from "vite-plus/test";

import { resolveManagedMailboxAccess } from "../src/mailbox/access";

const resolve = (
  overrides?: Partial<Parameters<typeof resolveManagedMailboxAccess>[0]>
) =>
  resolveManagedMailboxAccess({
    directRoles: [],
    divisionRoles: [],
    hasCandidateRow: false,
    isOwner: false,
    ...overrides,
  });

describe(resolveManagedMailboxAccess, () => {
  test("denies access when no grant rows exist and the caller is not the owner", () => {
    expect(
      resolve({
        directRoles: [],
        divisionRoles: [],
        hasCandidateRow: false,
        isOwner: false,
      })
    ).toBeNull();
  });

  test("takes the strongest role across direct and division grants", () => {
    expect(
      resolve({
        directRoles: ["manager"],
        divisionRoles: ["responder"],
        hasCandidateRow: true,
      })
    ).toBe("manager");
    expect(
      resolve({
        directRoles: ["reader"],
        divisionRoles: ["manager"],
        hasCandidateRow: true,
      })
    ).toBe("manager");
  });

  test("implies manager access for the owner of a private mailbox without any grant rows", () => {
    expect(resolve({ hasCandidateRow: false, isOwner: true })).toBe("manager");
  });

  test("enforces required roles against the effective role", () => {
    expect(
      resolve({
        directRoles: ["reader"],
        hasCandidateRow: true,
        requiredRoles: ["responder"],
      })
    ).toBeNull();
    expect(
      resolve({
        directRoles: ["reader"],
        hasCandidateRow: true,
        requiredRoles: ["reader"],
      })
    ).toBe("reader");
    expect(
      resolve({
        hasCandidateRow: false,
        isOwner: true,
        requiredRoles: ["manager"],
      })
    ).toBe("manager");
  });
});
