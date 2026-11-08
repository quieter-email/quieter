import { describe, expect, test } from "vite-plus/test";

import { validateActionSpecification } from "../src/action-specification";
import type { ActionSpecification } from "../src/action-specification";

const specification: ActionSpecification = {
  connectors: [
    { connectionId: "connection-product", referenceId: "product" },
    { connectionId: "connection-support", referenceId: "support" },
  ],
  instructions: "Read the message and look up the related product issue.",
  mailboxId: "mailbox-private",
  permissions: [
    { id: "mail-read", operation: "read", scope: "mailbox" },
    {
      connectorReferenceId: "product",
      id: "product-read",
      operation: "read",
      scope: "connector",
    },
    {
      connectorReferenceId: "support",
      id: "support-read",
      operation: "read",
      scope: "connector",
    },
  ],
  review: {
    assumptions: [],
    questions: [],
    summary: "Read incoming mail and look up relevant connected records.",
  },
  sourceText: "When mail arrives, look up its product issue.",
  toolGrants: [
    { confirmation: "none", permissionId: "mail-read", toolId: "mail.get" },
    {
      confirmation: "none",
      permissionId: "product-read",
      toolId: "records.search",
    },
    {
      confirmation: "none",
      permissionId: "support-read",
      toolId: "records.search",
    },
  ],
  trigger: { kind: "mail_received" },
  version: 1,
};

describe("action specification validation", () => {
  test.each([
    { input: { ...specification, version: 2 }, name: "unknown version" },
    { input: { ...specification, version: "1" }, name: "coerced version" },
    {
      input: { ...specification, instructions: " " },
      name: "empty instructions",
    },
    { input: { ...specification, sourceText: " " }, name: "empty source" },
    {
      input: { ...specification, mailboxId: " " },
      name: "missing mailbox scope",
    },
    {
      input: { ...specification, enabled: true },
      name: "submitted activation state",
    },
    {
      input: {
        ...specification,
        connectors: [
          {
            ...specification.connectors[0],
            accessToken: "private-fixture-value",
          },
        ],
      },
      name: "credential fields",
    },
  ])(
    "rejects $name without producing a persistable specification",
    ({ input }) => {
      const result = validateActionSpecification(input);

      expect(result).toMatchObject({ specification: null, status: "invalid" });
      expect(result.issues.length).toBeGreaterThan(0);
    }
  );

  test("keeps rejected submitted values out of validation messages", () => {
    const result = validateActionSpecification({
      ...specification,
      privateSubmittedField: "private-fixture-value",
      trigger: { kind: "private-submitted-value" },
    });

    expect(result.status).toBe("invalid");
    expect(JSON.stringify(result.issues)).not.toMatch(
      /private-submitted-value|private-fixture-value|privateSubmittedField/u
    );
  });

  test.each([
    {
      input: {
        ...specification,
        connectors: [
          specification.connectors[0],
          { connectionId: "connection-other", referenceId: "product" },
        ],
      },
      name: "ambiguous connector reference",
    },
    {
      input: {
        ...specification,
        connectors: [
          specification.connectors[0],
          { connectionId: "connection-product", referenceId: "other" },
        ],
      },
      name: "aliased connected account",
    },
    {
      input: {
        ...specification,
        permissions: [
          specification.permissions[0],
          { id: "mail-read", operation: "write", scope: "mailbox" },
        ],
      },
      name: "ambiguous permission identifier",
    },
    {
      input: {
        ...specification,
        permissions: [
          ...specification.permissions,
          { id: "also-mail-read", operation: "read", scope: "mailbox" },
        ],
      },
      name: "duplicate permission target",
    },
    {
      input: {
        ...specification,
        permissions: [
          ...specification.permissions,
          {
            connectorReferenceId: "missing",
            id: "missing-read",
            operation: "read",
            scope: "connector",
          },
        ],
      },
      name: "undeclared connector",
    },
    {
      input: {
        ...specification,
        toolGrants: [
          { confirmation: "none", permissionId: "missing", toolId: "mail.get" },
        ],
      },
      name: "undeclared permission",
    },
    {
      input: {
        ...specification,
        toolGrants: [...specification.toolGrants, specification.toolGrants[0]],
      },
      name: "duplicate tool authority",
    },
  ])("rejects $name with a field-level explanation", ({ input }) => {
    const result = validateActionSpecification(input);

    expect(result).toMatchObject({ specification: null, status: "invalid" });
    expect(
      result.issues.some((issue) =>
        /connectors|permissions|toolGrants/u.test(issue.path)
      )
    ).toBeTruthy();
  });

  test.each(["send", "delete"] as const)(
    "requires confirmation for %s tools",
    (operation) => {
      const input = {
        ...specification,
        permissions: [{ id: "mail-mutation", operation, scope: "mailbox" }],
        toolGrants: [
          {
            confirmation: "none",
            permissionId: "mail-mutation",
            toolId: "mail.mutate",
          },
        ],
      };

      expect(validateActionSpecification(input).status).toBe("invalid");
      expect(
        validateActionSpecification({
          ...input,
          toolGrants: [{ ...input.toolGrants[0], confirmation: "required" }],
        }).status
      ).toBe("valid");
    }
  );

  test("requires the same safeguard for connected-service sends", () => {
    const result = validateActionSpecification({
      ...specification,
      permissions: [
        {
          connectorReferenceId: "product",
          id: "external-send",
          operation: "send",
          scope: "connector",
        },
      ],
      toolGrants: [
        {
          confirmation: "none",
          permissionId: "external-send",
          toolId: "records.send",
        },
      ],
    });

    expect(result).toMatchObject({ specification: null, status: "invalid" });
  });

  test.each(["*", "mail.*", "mail.get,mail.send", "mail.get\nmail.send"])(
    "rejects tool selectors instead of exact tool IDs: %s",
    (toolId) => {
      const result = validateActionSpecification({
        ...specification,
        toolGrants: [
          { confirmation: "none", permissionId: "mail-read", toolId },
        ],
      });

      expect(result).toMatchObject({ specification: null, status: "invalid" });
    }
  );

  test.each([
    {
      assumptions: ["Assume the product connection is intended."],
      questions: [],
    },
    { assumptions: [], questions: ["Which connected account should be used?"] },
  ])("preserves unresolved interpretation for review", (review) => {
    const result = validateActionSpecification({
      ...specification,
      review: { ...specification.review, ...review },
    });

    expect(result).toMatchObject({
      specification: { review },
      status: "needs_review",
    });
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
