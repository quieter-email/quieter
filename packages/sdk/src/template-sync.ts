import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { controlOperations } from "@quieter/mail/control";
import { z } from "zod";

import { QuieterApiError } from "./api-error";
import type { ControlInput, EmailTemplate, Quieter } from "./index";

export type TemplateFields = Pick<
  ControlInput<"templates.create">,
  "name" | "subject" | "content"
>;

export type TemplateSyncSession = {
  close: () => Promise<void>;
  linkTemplate: (input: {
    key: string;
    signal?: AbortSignal;
    templateId: string;
  }) => Promise<EmailTemplate>;
  syncTemplate: (input: {
    fields: TemplateFields;
    key: string;
    signal?: AbortSignal;
  }) => Promise<{ changed: boolean; template: EmailTemplate }>;
};

const keySchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u)
  .refine((key) => !["constructor", "prototype", "__proto__"].includes(key));
const fieldsSchema = controlOperations["templates.create"].input.omit({
  idempotencyKey: true,
});
const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    input: controlOperations["templates.create"].input,
    kind: z.literal("creating"),
  }),
  z.strictObject({
    expectedUpdatedAt: z.iso.datetime(),
    fields: fieldsSchema,
    kind: z.literal("updating"),
    templateId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("synced"),
    templateId: z.string().min(1),
    updatedAt: z.iso.datetime(),
  }),
]);
const journalSchema = z.strictObject({
  baseUrl: z.url(),
  entries: z.record(keySchema, bindingSchema),
  organizationId: z.string().min(1),
  projectId: z.uuid(),
  version: z.literal(1),
});
type Journal = z.infer<typeof journalSchema>;
type Binding = z.infer<typeof bindingSchema>;

const lockSchema = z.strictObject({
  hostname: z.string().min(1),
  pid: z.number().int().positive(),
  token: z.uuid(),
});

const writeJournal = async (statePath: string, journal: Journal) => {
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(journal)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, statePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

export const openTemplateSync = async ({
  client,
  directory,
  projectId: suppliedProjectId,
  signal: sessionSignal,
}: {
  client: Quieter;
  directory: string;
  projectId: string;
  signal?: AbortSignal;
}): Promise<TemplateSyncSession> => {
  const projectId = z.uuid().parse(suppliedProjectId).toLowerCase();
  const target = new URL(client.baseUrl);
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/" ||
    !(
      target.protocol === "https:" ||
      (target.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
    )
  ) {
    throw new Error(
      "Template sync requires an HTTPS origin, or a loopback HTTP origin, without credentials, a path, or URL parameters."
    );
  }
  sessionSignal?.throwIfAborted();
  const baseUrl = target.origin;
  const stateDirectory = path.join(directory, ".quieter", projectId);
  const statePath = path.join(stateDirectory, "state.json");
  const lockPath = path.join(stateDirectory, "lock.json");
  await mkdir(stateDirectory, { mode: 0o700, recursive: true });
  const lock = { hostname: hostname(), pid: process.pid, token: randomUUID() };
  let lockFile;
  try {
    lockFile = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
    let owner: z.infer<typeof lockSchema> | undefined;
    try {
      owner = lockSchema.safeParse(
        JSON.parse(await readFile(lockPath, "utf-8"))
      ).data;
    } catch {
      owner = undefined;
    }
    const ownership = owner
      ? `PID ${owner.pid} on ${owner.hostname}`
      : "an unknown process";
    throw new QuieterApiError({
      message: `Template sync is locked by ${ownership}. Stop the owner first. After confirming that it has exited, remove only ${lockPath} and retry.`,
      status: 409,
    });
  }
  try {
    await lockFile.writeFile(`${JSON.stringify(lock)}\n`);
    await lockFile.sync();
  } finally {
    await lockFile.close();
  }

  const releaseLock = async () => {
    try {
      const owner = lockSchema.safeParse(
        JSON.parse(await readFile(lockPath, "utf-8"))
      ).data;
      if (owner?.token === lock.token) {
        await rm(lockPath);
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
  };

  try {
    const { organizationId } = await client.templates.list(
      { limit: 1 },
      { signal: sessionSignal }
    );
    let journal: Journal = {
      baseUrl,
      entries: {},
      organizationId,
      projectId,
      version: 1,
    };
    try {
      journal = journalSchema.parse(
        JSON.parse(await readFile(statePath, "utf-8"))
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw new Error(
          `The template sync state at ${statePath} is invalid. Keep it for recovery and restore a valid copy before retrying.`,
          { cause: error }
        );
      }
    }
    if (
      journal.baseUrl !== baseUrl ||
      journal.organizationId !== organizationId ||
      journal.projectId !== projectId
    ) {
      throw new QuieterApiError({
        message:
          "This template project is connected to a different site or team. Use its original API key and site, or initialize a separate project for the new target.",
        status: 409,
      });
    }
    await writeJournal(statePath, journal);
    let closed = false;
    let active: Promise<unknown> | undefined;

    const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (closed || active !== undefined) {
        throw new QuieterApiError({
          message: closed
            ? "This template sync session is closed."
            : "Another operation is already running in this template sync session.",
          status: 409,
        });
      }
      const result = operation();
      active = result;
      try {
        return await result;
      } finally {
        active = undefined;
      }
    };

    const saveBinding = async (key: string, binding: Binding) => {
      const next = {
        ...journal,
        entries: { ...journal.entries, [key]: binding },
      };
      await writeJournal(statePath, next);
      journal = next;
    };

    const loadTemplate = async (templateId: string, signal?: AbortSignal) => {
      const template = await client.templates.get({ templateId }, { signal });
      if (
        template.organizationId !== organizationId ||
        template.id !== templateId
      ) {
        throw new QuieterApiError({
          message: "The saved template does not belong to this connected team.",
          status: 409,
        });
      }
      if (template.archivedAt !== null) {
        throw new QuieterApiError({
          message:
            "This template is archived. Restore it in Quieter before syncing.",
          status: 409,
        });
      }
      return template;
    };

    return {
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        if (active !== undefined) {
          await Promise.allSettled([active]);
        }
        await releaseLock();
      },
      linkTemplate: async ({ key: suppliedKey, templateId, signal }) =>
        await runExclusive(async () => {
          const key = keySchema.parse(suppliedKey);
          const requestSignal = signal ?? sessionSignal;
          requestSignal?.throwIfAborted();
          const template = await loadTemplate(templateId, requestSignal);
          await saveBinding(key, {
            kind: "synced",
            templateId: template.id,
            updatedAt: template.updatedAt,
          });
          return template;
        }),
      syncTemplate: async ({
        key: suppliedKey,
        fields: suppliedFields,
        signal,
      }) =>
        await runExclusive(async () => {
          const key = keySchema.parse(suppliedKey);
          const fields = fieldsSchema.parse(suppliedFields);
          const requestSignal = signal ?? sessionSignal;
          requestSignal?.throwIfAborted();
          const options = { signal: requestSignal };
          let binding = Object.hasOwn(journal.entries, key)
            ? journal.entries[key]
            : undefined;
          let current: EmailTemplate | undefined;
          let changed = false;
          if (binding === undefined) {
            binding = {
              input: {
                ...fields,
                idempotencyKey: `quieter-template:${createHash("sha256")
                  .update(JSON.stringify([projectId, key]))
                  .digest("hex")}`,
              },
              kind: "creating",
            };
            await saveBinding(key, binding);
          }
          if (binding.kind === "creating") {
            const result = await client.templates.create(
              binding.input,
              options
            );
            changed = true;
            current = await loadTemplate(result.id, requestSignal);
            if (
              !isDeepStrictEqual(
                fieldsSchema.parse(current),
                fieldsSchema.parse(binding.input)
              )
            ) {
              throw new QuieterApiError({
                message: `Template ${key} changed after its creation. Review it in Quieter, then run quieter templates link ${key} ${current.id} to accept that version.`,
                status: 409,
              });
            }
            binding = {
              kind: "synced",
              templateId: current.id,
              updatedAt: current.updatedAt,
            };
            await saveBinding(key, binding);
          }
          if (binding.kind === "updating") {
            current = await loadTemplate(binding.templateId, requestSignal);
            if (
              !isDeepStrictEqual(fieldsSchema.parse(current), binding.fields)
            ) {
              if (current.updatedAt !== binding.expectedUpdatedAt) {
                throw new QuieterApiError({
                  message: `Template ${key} changed while an upload was pending. Review it in Quieter, then run quieter templates link ${key} ${current.id} to accept that version.`,
                  status: 409,
                });
              }
              current = await client.templates.update(
                {
                  ...binding.fields,
                  expectedUpdatedAt: binding.expectedUpdatedAt,
                  templateId: binding.templateId,
                },
                options
              );
              changed = true;
            }
            binding = {
              kind: "synced",
              templateId: current.id,
              updatedAt: current.updatedAt,
            };
            await saveBinding(key, binding);
          }
          current ??= await loadTemplate(binding.templateId, requestSignal);
          if (isDeepStrictEqual(fieldsSchema.parse(current), fields)) {
            if (binding.updatedAt !== current.updatedAt) {
              await saveBinding(key, {
                kind: "synced",
                templateId: current.id,
                updatedAt: current.updatedAt,
              });
            }
            return { changed, template: current };
          }
          if (current.updatedAt !== binding.updatedAt) {
            throw new QuieterApiError({
              message: `Template ${key} has a newer saved version. Review it in Quieter, then run quieter templates link ${key} ${current.id} to accept that version.`,
              status: 409,
            });
          }
          await saveBinding(key, {
            expectedUpdatedAt: current.updatedAt,
            fields,
            kind: "updating",
            templateId: current.id,
          });
          const template = await client.templates.update(
            {
              ...fields,
              expectedUpdatedAt: current.updatedAt,
              templateId: current.id,
            },
            options
          );
          await saveBinding(key, {
            kind: "synced",
            templateId: template.id,
            updatedAt: template.updatedAt,
          });
          return { changed: true, template };
        }),
    };
  } catch (error) {
    await releaseLock();
    throw error;
  }
};
