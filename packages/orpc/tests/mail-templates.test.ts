import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type * as DatabaseClientModule from "@quieter/database/client";
import { db } from "@quieter/database/client";
import { mailTemplate } from "@quieter/database/schema";
import { renderVisualEmailDocument } from "@quieter/mail/visual-email";
import type { VisualEmailDocument } from "@quieter/mail/visual-email";
import { getTableColumns } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { mailTemplatesRouter } from "../src/routers/mail-templates";

type StoredTemplate = Omit<typeof mailTemplate.$inferSelect, "document"> & {
  document: unknown;
};

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy exercises the router's generated database conditions.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Authentication only needs the signed-in identity here.
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: async () => {
    await Promise.resolve();
    return {
      session: { id: "session" },
      user: { email: "owner@example.test", id: "owner", name: "Owner" },
    };
  },
}));
vi.mock(import("../src/mailbox/service"), async () => {
  const { getMailboxCapabilities } = await import("@quieter/mail/data-plane");
  return {
    assertAccessibleMailbox: async () => {
      await Promise.resolve();
      return {
        capabilities: getMailboxCapabilities({ provider: "gmail" }),
        contentRevision: 0,
        id: "mailbox",
        organizationId: "team",
        provider: "gmail" as const,
      };
    },
  };
});
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("@quieter/billing"), () => ({
  reportAiUsage: vi.fn<() => Promise<void>>(),
}));

const document: VisualEmailDocument = {
  content: {
    content: [
      {
        content: [
          { text: "Hello ", type: "text" },
          { attrs: { label: "First name" }, type: "templatePlaceholder" },
        ],
        type: "paragraph",
      },
    ],
    type: "doc",
  },
  version: 1,
};
const input = {
  bodyHtml: "<p>Caller supplied HTML</p>",
  mailboxId: "mailbox",
  name: "Welcome",
  scope: "personal" as const,
  subject: "Hello",
};
const context = { db, headers: new Headers() };
const client = createRouterClient(mailTemplatesRouter, { context });
const handler = new RPCHandler(mailTemplatesRouter);

const templateRow = (overrides: Partial<StoredTemplate> = {}) => {
  const template: StoredTemplate = {
    bodyHtml: "<p>Legacy content</p>",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    document: null,
    id: "template",
    name: "Welcome",
    organizationId: null,
    scope: "personal",
    subject: "Hello",
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    userId: "owner",
    ...overrides,
  };

  const values: Record<string, unknown> = template;
  return Object.keys(getTableColumns(mailTemplate)).map((key) => {
    const value = values[key];
    return value instanceof Date ? value.toISOString() : value;
  });
};

const mutationValues = (operation: "insert" | "update") => {
  const [query, params] = mocks.query.mock.calls.find(([sql]) =>
    sql.startsWith(operation)
  ) ?? ["", []];
  const values = new Map<string, unknown>();

  if (operation === "update") {
    for (const match of query.matchAll(
      /"(?<column>\w+)" = \$(?<index>\d+)/gu
    )) {
      const { column, index } = match.groups ?? {};
      if (column !== undefined) {
        values.set(column, params[Number(index) - 1]);
      }
    }
    return values;
  }

  const match = /\((?<columns>[^)]+)\) values \((?<bindings>[^)]+)\)/u.exec(
    query
  );
  const columns = match?.groups?.columns?.split(", ") ?? [];
  const bindings = match?.groups?.bindings?.split(", ") ?? [];
  for (const [index, column] of columns.entries()) {
    const binding = bindings[index];
    if (binding !== undefined && binding.startsWith("$")) {
      values.set(
        column.replaceAll('"', ""),
        params[Number(binding.slice(1)) - 1]
      );
    }
  }
  return values;
};

describe("mail template persistence and access", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
  });

  test("creates a visual template using HTML rendered from its source", async () => {
    const bodyHtml = renderVisualEmailDocument(document);
    mocks.query.mockResolvedValueOnce({ rows: [] });
    mocks.query.mockResolvedValueOnce({
      rows: [templateRow({ bodyHtml, document })],
    });

    await expect(client.create({ ...input, document })).resolves.toMatchObject({
      bodyHtml,
      document,
      documentError: null,
    });
    const values = mutationValues("insert");
    expect(values.get("bodyHtml")).toBe(bodyHtml);
    expect(values.get("bodyHtml")).not.toBe(input.bodyHtml);
    expect(values.get("document")).toMatchObject(document);
  });

  test("updates a legacy template with authoritative visual source and HTML", async () => {
    const bodyHtml = renderVisualEmailDocument(document);
    mocks.query.mockResolvedValueOnce({ rows: [] });
    mocks.query.mockResolvedValueOnce({ rows: [templateRow()] });
    mocks.query.mockResolvedValueOnce({
      rows: [templateRow({ bodyHtml, document })],
    });

    await expect(
      client.update({ ...input, document, id: "template" })
    ).resolves.toMatchObject({ bodyHtml, document, documentError: null });
    const values = mutationValues("update");
    expect(values.get("bodyHtml")).toBe(bodyHtml);
    expect(values.get("document")).toMatchObject(document);
  });

  test.each([null, undefined])(
    "clears stale visual source when updating with legacy HTML and document %s",
    async (source) => {
      mocks.query.mockResolvedValueOnce({ rows: [] });
      mocks.query.mockResolvedValueOnce({ rows: [templateRow({ document })] });
      mocks.query.mockResolvedValueOnce({
        rows: [templateRow({ bodyHtml: input.bodyHtml })],
      });

      await expect(
        client.update({ ...input, document: source, id: "template" })
      ).resolves.toMatchObject({
        bodyHtml: input.bodyHtml,
        document: null,
        documentError: null,
      });
      const values = mutationValues("update");
      expect(values.get("bodyHtml")).toBe(input.bodyHtml);
      expect(values.get("document")).toBeNull();
    }
  );

  test.each([
    { name: "an unsupported version", source: { ...document, version: 2 } },
    {
      name: "an unsafe image URL",
      source: {
        content: {
          // oxlint-disable-next-line eslint/no-script-url -- Exercise rejection of an unsafe document URL.
          content: [{ attrs: { src: "javascript:alert(1)" }, type: "image" }],
          type: "doc",
        },
        version: 1,
      },
    },
  ])("rejects $name before a database write", async ({ source }) => {
    const result = await handler.handle(
      new Request("https://example.test/create", {
        body: JSON.stringify({ json: { ...input, document: source } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { context }
    );

    expect(result.response?.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  test.each([
    { name: "unsupported", source: { ...document, version: 2 } },
    { name: "corrupt", source: { version: 1 } },
  ])(
    "keeps stored HTML usable when visual source is $name",
    async ({ source }) => {
      mocks.query.mockResolvedValueOnce({ rows: [] });
      mocks.query.mockResolvedValueOnce({
        rows: [templateRow({ document: source })],
      });

      const result = await client.list({ mailboxId: "mailbox" });
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0]).toMatchObject({
        bodyHtml: "<p>Legacy content</p>",
        document: null,
      });
      expect(result.templates[0]?.documentError).toBeTypeOf("string");
    }
  );

  test("does not include team templates for an accessible mailbox's nonmember", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    mocks.query.mockResolvedValueOnce({ rows: [templateRow()] });

    await expect(client.list({ mailboxId: "mailbox" })).resolves.toMatchObject({
      canManageTeamTemplates: false,
      templates: [{ id: "template", scope: "personal" }],
    });
    const [query, params] = mocks.query.mock.calls[1] ?? [];
    expect(query).not.toMatch(/"organizationId" =/u);
    expect(params).toContain("owner");
    expect(params).not.toContain("team");
  });

  test("allows ordinary members to read team templates without editing them", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [["member"]] });
    mocks.query.mockResolvedValueOnce({
      rows: [
        templateRow({ organizationId: "team", scope: "team", userId: null }),
      ],
    });

    await expect(client.list({ mailboxId: "mailbox" })).resolves.toMatchObject({
      templates: [{ canEdit: false, scope: "team" }],
    });
    const [, params] = mocks.query.mock.calls[1] ?? [];
    expect(params).toContain("team");
  });

  test("denies creating a team template without a manager membership", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [["member"]] });

    await expect(
      client.create({ ...input, document, scope: "team" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mutationValues("insert").size).toBe(0);
  });

  test.each([
    {
      name: "another user's personal template",
      template: { userId: "another-owner" },
    },
    {
      name: "another organization's team template",
      template: {
        organizationId: "another-team",
        scope: "team" as const,
        userId: null,
      },
    },
  ])(
    "denies updating $name even for a mailbox team owner",
    async ({ template }) => {
      mocks.query.mockResolvedValueOnce({ rows: [["owner"]] });
      mocks.query.mockResolvedValueOnce({ rows: [templateRow(template)] });

      await expect(
        client.update({ ...input, document, id: "template" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mutationValues("update").size).toBe(0);
    }
  );

  test("denies deleting a team template for a nonmember with mailbox access", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    mocks.query.mockResolvedValueOnce({
      rows: [
        templateRow({ organizationId: "team", scope: "team", userId: null }),
      ],
    });

    await expect(
      client.delete({ id: "template", mailboxId: "mailbox" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      mocks.query.mock.calls.some(([query]) => query.startsWith("delete"))
    ).toBeFalsy();
  });
});
