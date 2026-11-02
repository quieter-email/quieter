/* oxlint-disable no-await-in-loop -- Render one email at a time to bound local work. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderEmailContent } from "@quieter/mail/email-design";
import type { EmailContent } from "@quieter/mail/email-design";
import { templateCreateInputSchema } from "@quieter/mail/templates";
import type { ComponentType } from "react";
import { z } from "zod";

import type { TemplateFields } from "./template-sync";

const sourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    file: z.string().trim().min(1),
    kind: z.literal("react"),
    props: z.record(z.string(), z.json()).optional(),
    text: z.string().max(100_000).optional(),
  }),
  z.strictObject({
    file: z.string().trim().min(1),
    kind: z.literal("html"),
    text: z.string().max(100_000).optional(),
  }),
  z.strictObject({
    file: z.string().trim().min(1),
    kind: z.literal("text"),
  }),
  z.strictObject({
    file: z.string().trim().min(1),
    kind: z.literal("visual"),
  }),
]);

const fieldsSchema = templateCreateInputSchema.pick({
  content: true,
  name: true,
  subject: true,
});

export const templateProjectSchema = z.strictObject({
  projectId: z.uuid(),
  templates: z
    .record(
      z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u)
        .refine(
          (key) => !["constructor", "prototype", "__proto__"].includes(key),
          "Choose a template key that is not a reserved property name."
        ),
      z.strictObject({
        name: fieldsSchema.shape.name,
        source: sourceSchema,
        subject: fieldsSchema.shape.subject,
      })
    )
    .refine((templates) => Object.keys(templates).length > 0, {
      message: "Add at least one template to the project.",
    }),
});

export type TemplateProject = z.infer<typeof templateProjectSchema>;

export const readTemplateProject = async (
  configPath: string
): Promise<TemplateProject> => {
  const json: unknown = JSON.parse(await readFile(configPath, "utf-8"));
  return templateProjectSchema.parse(json);
};

export const renderTemplateProject = async ({
  directory,
  only,
  project,
}: {
  directory: string;
  only?: string;
  project: TemplateProject;
}): Promise<Record<string, TemplateFields>> => {
  if (only !== undefined && !Object.hasOwn(project.templates, only)) {
    throw new Error(`No template named "${only}" exists in this project.`);
  }
  const templates: Record<string, TemplateFields> = {};
  for (const [key, definition] of Object.entries(project.templates)) {
    if (only !== undefined && key !== only) {
      continue;
    }
    const { source } = definition;
    const file = path.resolve(directory, source.file);
    let content: EmailContent;
    switch (source.kind) {
      case "react": {
        const [{ createJiti }, { createElement }, { renderReactEmail }] =
          await Promise.all([
            import("jiti"),
            import("react"),
            import("./react"),
          ]);
        const load = createJiti(pathToFileURL(file).href, {
          fsCache: false,
          interopDefault: false,
          jsx: { runtime: "automatic" },
          moduleCache: false,
          tryNative: false,
        });
        const module: unknown = await load.import(file);
        const parsed = z
          .object({
            default: z.custom<ComponentType<Record<string, unknown>>>(
              (value) => typeof value === "function",
              "Export a default React component from the source file."
            ),
          })
          .parse(module);
        content = await renderReactEmail(
          createElement(parsed.default, source.props ?? {}),
          source.text
        );
        break;
      }
      case "html": {
        const html = await readFile(file, "utf-8");
        content = {
          html,
          kind: "html",
          text:
            source.text ??
            renderEmailContent({ html, kind: "html", text: "" }).text,
        };
        break;
      }
      case "text": {
        content = { kind: "text", text: await readFile(file, "utf-8") };
        break;
      }
      case "visual": {
        const design: unknown = JSON.parse(await readFile(file, "utf-8"));
        const parsed = fieldsSchema.shape.content.parse({
          design,
          kind: "visual",
        });
        content = parsed;
        break;
      }
      default: {
        const exhaustive: never = source;
        throw new Error(`Unsupported template source: ${String(exhaustive)}`);
      }
    }
    templates[key] = fieldsSchema.parse({
      content,
      name: definition.name,
      subject: definition.subject,
    });
  }
  return templates;
};
