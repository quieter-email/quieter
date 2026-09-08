import { describe, expect, test } from "vite-plus/test";

import {
  getStrongestMailboxGrantRole,
  resolveManagedMailboxAccess,
} from "../src/mailbox/access";

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

  test("resolves a direct reader grant", () => {
    expect(resolve({ directRoles: ["reader"], hasCandidateRow: true })).toBe(
      "reader"
    );
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

  test("owner role outranks an explicitly downgraded grant", () => {
    expect(
      resolve({ directRoles: ["reader"], hasCandidateRow: true, isOwner: true })
    ).toBe("manager");
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

describe(getStrongestMailboxGrantRole, () => {
  test("ignores null and undefined candidates", () => {
    expect(getStrongestMailboxGrantRole([null, undefined])).toBeNull();
  });

  test("ranks manager above responder above reader", () => {
    expect(getStrongestMailboxGrantRole(["reader", "responder"])).toBe(
      "responder"
    );
    expect(
      getStrongestMailboxGrantRole(["responder", "manager", "reader"])
    ).toBe("manager");
  });
});
