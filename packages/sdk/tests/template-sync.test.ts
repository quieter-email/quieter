import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { controlOperations } from "@quieter/mail/control";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { Quieter, QuieterApiError } from "../src";
import type { EmailTemplate } from "../src";
import { openTemplateSync } from "../src/template-sync";
import type { TemplateFields, TemplateSyncSession } from "../src/template-sync";

const operationSchema = z.object({
  input: z.unknown(),
  operation: z.enum([
    "templates.list",
    "templates.get",
    "templates.create",
    "templates.update",
  ]),
});
type Operation = z.infer<typeof operationSchema>["operation"];
const fieldsSchema = controlOperations["templates.create"].input.omit({
  idempotencyKey: true,
});
const originalFields: TemplateFields = {
  content: { kind: "text", text: "Welcome, Avery." },
  name: "Welcome",
  subject: "Your account is ready",
};
const revisedFields: TemplateFields = {
  ...originalFields,
  content: { kind: "text", text: "Your workspace is ready, Avery." },
};
const sessions: TemplateSyncSession[] = [];
const directories: string[] = [];

const createProject = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "quieter-template-sync-")
  );
  directories.push(directory);
  return { directory, projectId: randomUUID() };
};

const connect = async (options: Parameters<typeof openTemplateSync>[0]) => {
  const session = await openTemplateSync(options);
  sessions.push(session);
  return session;
};

const createApi = () => {
  const templates = new Map<string, EmailTemplate>();
  const receipts = new Map<string, { input: string; result: EmailTemplate }>();
  const keys = new Map([
    ["first", "team-one"],
    ["rotated", "team-one"],
    ["other", "team-two"],
  ]);
  let revision = 0;
  const fixture: {
    failure?: { operation: Operation; phase: "before" | "after" };
  } = {};
  const fetchApi: NonNullable<
    ConstructorParameters<typeof Quieter>[0]["fetch"]
  > = async (input, init) => {
    const request = new Request(input, init);
    const organizationId = keys.get(
      (request.headers.get("authorization") ?? "").replace(/^Bearer /u, "")
    );
    if (organizationId === undefined) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { operation, input: body } = operationSchema.parse(
      await request.json()
    );
    if (
      fixture.failure?.operation === operation &&
      fixture.failure.phase === "before"
    ) {
      fixture.failure = undefined;
      throw new TypeError(
        "Network connection closed before applying the request."
      );
    }
    let result: unknown;
    switch (operation) {
      case "templates.list": {
        const items = [...templates.values()].filter(
          (template) => template.organizationId === organizationId
        );
        result = {
          items,
          nextOffset: null,
          organizationId,
          totalCount: items.length,
        };
        break;
      }
      case "templates.get": {
        const parsed = controlOperations[operation].input.parse(body);
        const template = templates.get(parsed.templateId);
        if (template?.organizationId !== organizationId) {
          return Response.json(
            { error: "Template not found" },
            { status: 404 }
          );
        }
        result = template;
        break;
      }
      case "templates.create": {
        const parsed = controlOperations[operation].input.parse(body);
        const receiptKey = `${organizationId}:${parsed.idempotencyKey}`;
        const prior = receipts.get(receiptKey);
        if (prior === undefined) {
          revision += 1;
          const now = new Date(Date.UTC(2026, 0, 1) + revision).toISOString();
          const template: EmailTemplate = {
            ...fieldsSchema.parse(parsed),
            archivedAt: null,
            createdAt: now,
            id: randomUUID(),
            organizationId,
            updatedAt: now,
          };
          templates.set(template.id, template);
          receipts.set(receiptKey, {
            input: JSON.stringify(parsed),
            result: template,
          });
          result = template;
        } else {
          if (prior.input !== JSON.stringify(parsed)) {
            return Response.json(
              { error: "Idempotency conflict" },
              { status: 409 }
            );
          }
          ({ result } = prior);
        }
        break;
      }
      case "templates.update": {
        const parsed = controlOperations[operation].input.parse(body);
        const template = templates.get(parsed.templateId);
        if (template?.organizationId !== organizationId) {
          return Response.json(
            { error: "Template not found" },
            { status: 404 }
          );
        }
        if (template.updatedAt !== parsed.expectedUpdatedAt) {
          return Response.json({ error: "Version conflict" }, { status: 409 });
        }
        revision += 1;
        const updated = {
          ...template,
          ...fieldsSchema.parse(parsed),
          updatedAt: new Date(Date.UTC(2026, 0, 1) + revision).toISOString(),
        };
        templates.set(updated.id, updated);
        result = updated;
        break;
      }
      default: {
        const exhaustive: never = operation;
        throw new Error("Unsupported template operation", {
          cause: exhaustive,
        });
      }
    }
    if (
      fixture.failure?.operation === operation &&
      fixture.failure.phase === "after"
    ) {
      fixture.failure = undefined;
      throw new TypeError(
        "Network connection closed after applying the request."
      );
    }
    return Response.json(result);
  };
  return {
    client: ({
      apiKey = "first",
      baseUrl = "https://templates.example.test",
    } = {}) => new Quieter({ apiKey, baseUrl, fetch: fetchApi }),
    edit: (templateId: string, fields: TemplateFields, archived = false) => {
      const previous = templates.get(templateId);
      if (previous === undefined) {
        throw new Error("Missing test template");
      }
      revision += 1;
      const now = new Date(Date.UTC(2026, 0, 1) + revision).toISOString();
      const template = {
        ...previous,
        ...fieldsSchema.parse(fields),
        archivedAt: archived ? now : null,
        updatedAt: now,
      };
      templates.set(templateId, template);
      return template;
    },
    fixture,
    templates,
  };
};

describe("local template sync", () => {
  afterEach(async () => {
    await Promise.all(
      sessions.splice(0).map(async (session) => {
        await session.close();
      })
    );
    await Promise.all(
      directories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  test.each(["toString", "valueOf", "hasOwnProperty"])(
    "syncs the logical key %s as a template",
    async (key) => {
      const project = await createProject();
      const api = createApi();
      const session = await connect({ ...project, client: api.client() });
      const created = await session.syncTemplate({
        fields: originalFields,
        key,
      });
      const updated = await session.syncTemplate({
        fields: revisedFields,
        key,
      });
      expect(updated.template.id).toBe(created.template.id);
      expect(updated.template.content).toMatchObject(revisedFields.content);
      expect(api.templates.size).toBe(1);
    }
  );

  test("keeps identity while updating content and metadata, preserving explicit text", async () => {
    const project = await createProject();
    const api = createApi();
    const session = await connect({ ...project, client: api.client() });
    const first = await session.syncTemplate({
      fields: originalFields,
      key: "welcome",
    });
    const second = await session.syncTemplate({
      fields: {
        content: {
          html: "<p>Hello Avery.</p>",
          kind: "html",
          text: "An explicit fallback.",
        },
        name: "Account ready",
        subject: "Your workspace",
      },
      key: "welcome",
    });
    expect(second.template.id).toBe(first.template.id);
    expect(second.template).toMatchObject({
      content: { kind: "html", text: "An explicit fallback." },
      name: "Account ready",
    });
    expect(api.templates.size).toBe(1);
    await expect(
      session.syncTemplate({
        fields: { ...originalFields, name: "" },
        key: "invalid",
      })
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(api.templates.size).toBe(1);
  });

  test.each(["before", "after"] as const)(
    "recovers an interrupted create %s application with changed source",
    async (phase) => {
      const project = await createProject();
      const api = createApi();
      const session = await connect({ ...project, client: api.client() });
      api.fixture.failure = { operation: "templates.create", phase };
      await expect(
        session.syncTemplate({ fields: originalFields, key: "welcome" })
      ).rejects.toBeInstanceOf(TypeError);
      await session.close();
      const resumed = await connect({ ...project, client: api.client() });
      const result = await resumed.syncTemplate({
        fields: revisedFields,
        key: "welcome",
      });
      expect(result.template.content).toMatchObject({
        text: "Your workspace is ready, Avery.",
      });
      expect(api.templates.size).toBe(1);
    }
  );

  test.each(["before", "after"] as const)(
    "recovers an interrupted update %s application with newer source",
    async (phase) => {
      const project = await createProject();
      const api = createApi();
      const session = await connect({ ...project, client: api.client() });
      const first = await session.syncTemplate({
        fields: originalFields,
        key: "welcome",
      });
      api.fixture.failure = { operation: "templates.update", phase };
      await expect(
        session.syncTemplate({ fields: revisedFields, key: "welcome" })
      ).rejects.toBeInstanceOf(TypeError);
      await session.close();
      const resumed = await connect({ ...project, client: api.client() });
      const result = await resumed.syncTemplate({
        fields: { ...revisedFields, subject: "Final version" },
        key: "welcome",
      });
      expect(result.template.id).toBe(first.template.id);
      expect(result.template).toMatchObject({
        content: { text: "Your workspace is ready, Avery." },
        subject: "Final version",
      });
      expect(api.templates.size).toBe(1);
    }
  );

  test("protects browser edits until an explicit link accepts their version", async () => {
    const project = await createProject();
    const api = createApi();
    const session = await connect({ ...project, client: api.client() });
    const { template } = await session.syncTemplate({
      fields: originalFields,
      key: "welcome",
    });
    api.edit(template.id, {
      ...originalFields,
      subject: "Saved in the browser",
    });
    await expect(
      session.syncTemplate({ fields: revisedFields, key: "welcome" })
    ).rejects.toMatchObject({ status: 409 });
    expect(api.templates.get(template.id)?.subject).toBe(
      "Saved in the browser"
    );
    await session.linkTemplate({ key: "welcome", templateId: template.id });
    const synced = await session.syncTemplate({
      fields: revisedFields,
      key: "welcome",
    });
    expect(synced.template.content).toMatchObject({
      text: "Your workspace is ready, Avery.",
    });
  });

  test.each(["templates.create", "templates.update"] as const)(
    "protects remote edits while %s is uncertain",
    async (operation) => {
      const project = await createProject();
      const api = createApi();
      const session = await connect({ ...project, client: api.client() });
      if (operation === "templates.update") {
        await session.syncTemplate({ fields: originalFields, key: "welcome" });
      }
      api.fixture.failure = { operation, phase: "after" };
      await expect(
        session.syncTemplate({ fields: revisedFields, key: "welcome" })
      ).rejects.toBeInstanceOf(TypeError);
      const [saved] = api.templates.values();
      expect(saved).toBeDefined();
      if (saved === undefined) {
        throw new Error("Interrupted write did not save a template");
      }
      api.edit(saved.id, {
        ...originalFields,
        subject: "Browser won the race",
      });
      await session.close();
      const resumed = await connect({ ...project, client: api.client() });
      await expect(
        resumed.syncTemplate({ fields: originalFields, key: "welcome" })
      ).rejects.toMatchObject({ status: 409 });
      expect(api.templates.get(saved.id)?.subject).toBe("Browser won the race");
    }
  );

  test.each(["templates.get", "templates.create", "templates.update"] as const)(
    "does not change archived templates after an interrupted %s",
    async (operation) => {
      const project = await createProject();
      const api = createApi();
      const session = await connect({ ...project, client: api.client() });
      if (operation !== "templates.create") {
        await session.syncTemplate({ fields: originalFields, key: "welcome" });
      }
      api.fixture.failure = { operation, phase: "after" };
      await expect(
        session.syncTemplate({ fields: revisedFields, key: "welcome" })
      ).rejects.toBeInstanceOf(TypeError);
      const [saved] = api.templates.values();
      if (saved === undefined) {
        throw new Error("Missing saved template");
      }
      api.edit(saved.id, originalFields, true);
      await session.close();
      const resumed = await connect({ ...project, client: api.client() });
      await expect(
        resumed.syncTemplate({ fields: revisedFields, key: "welcome" })
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        resumed.linkTemplate({ key: "welcome", templateId: saved.id })
      ).rejects.toMatchObject({ status: 409 });
      expect(api.templates.get(saved.id)?.archivedAt).not.toBeNull();
    }
  );

  test("allows key rotation and rejects a different team or site before mutation", async () => {
    const project = await createProject();
    const api = createApi();
    const session = await connect({ ...project, client: api.client() });
    const first = await session.syncTemplate({
      fields: originalFields,
      key: "welcome",
    });
    await session.close();
    const rotated = await connect({
      ...project,
      client: api.client({ apiKey: "rotated" }),
    });
    const result = await rotated.syncTemplate({
      fields: revisedFields,
      key: "welcome",
    });
    expect(result.template.id).toBe(first.template.id);
    await rotated.close();
    await expect(
      connect({ ...project, client: api.client({ apiKey: "other" }) })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      connect({
        ...project,
        client: api.client({ baseUrl: "https://other.example.test" }),
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(api.templates.size).toBe(1);
  });

  test("pins an empty project to its team before the first template upload", async () => {
    const project = await createProject();
    const api = createApi();
    const session = await connect({ ...project, client: api.client() });
    await session.close();
    await expect(
      connect({ ...project, client: api.client({ apiKey: "other" }) })
    ).rejects.toMatchObject({ status: 409 });
    expect(api.templates.size).toBe(0);
  });

  test("reuses creation receipts after state loss and rejects changed input instead of duplicating", async () => {
    const project = await createProject();
    const api = createApi();
    const session = await connect({ ...project, client: api.client() });
    const first = await session.syncTemplate({
      fields: originalFields,
      key: "welcome",
    });
    await session.close();
    const statePath = path.join(
      project.directory,
      ".quieter",
      project.projectId,
      "state.json"
    );
    await rm(statePath);
    const recovered = await connect({ ...project, client: api.client() });
    const result = await recovered.syncTemplate({
      fields: originalFields,
      key: "welcome",
    });
    expect(result.template.id).toBe(first.template.id);
    await recovered.close();
    await rm(statePath);
    const changed = await connect({ ...project, client: api.client() });
    await expect(
      changed.syncTemplate({ fields: revisedFields, key: "welcome" })
    ).rejects.toBeInstanceOf(QuieterApiError);
    expect(api.templates.size).toBe(1);
  });

  test("rejects simultaneous sessions and operations without losing the accepted write", async () => {
    const project = await createProject();
    const api = createApi();
    const session = await connect({ ...project, client: api.client() });
    await expect(
      connect({ ...project, client: api.client() })
    ).rejects.toMatchObject({ status: 409 });
    const active = session.syncTemplate({
      fields: originalFields,
      key: "welcome",
    });
    await expect(
      session.syncTemplate({ fields: revisedFields, key: "welcome" })
    ).rejects.toMatchObject({ status: 409 });
    await expect(active).resolves.toMatchObject({
      template: { content: { text: "Welcome, Avery." } },
    });
    expect(api.templates.size).toBe(1);
  });

  test("does not remove a replacement owner's lock when closing", async () => {
    const firstProject = await createProject();
    const otherProject = await createProject();
    const api = createApi();
    const first = await connect({ ...firstProject, client: api.client() });
    await connect({ ...otherProject, client: api.client() });
    const firstLock = path.join(
      firstProject.directory,
      ".quieter",
      firstProject.projectId,
      "lock.json"
    );
    const otherLock = path.join(
      otherProject.directory,
      ".quieter",
      otherProject.projectId,
      "lock.json"
    );
    await writeFile(firstLock, await readFile(otherLock));
    await first.close();
    await expect(
      connect({ ...firstProject, client: api.client() })
    ).rejects.toMatchObject({ status: 409 });
    expect(api.templates.size).toBe(0);
  });

  test.each([
    "http://remote.example.test",
    "https://name:password@templates.example.test",
    "https://templates.example.test/prefix",
    "https://templates.example.test?value=one",
    "https://templates.example.test#fragment",
  ])(
    "rejects unsafe target %s before creating state or templates",
    async (baseUrl) => {
      const project = await createProject();
      const api = createApi();
      await expect(
        connect({ ...project, client: api.client({ baseUrl }) })
      ).rejects.toThrow(/origin/u);
      expect(api.templates.size).toBe(0);
    }
  );
});
