import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createEmailDesign,
  renderEmailContent,
} from "@quieter/mail/email-design";
import { describe, expect, onTestFinished, test } from "vite-plus/test";

import {
  readTemplateProject,
  renderTemplateProject,
  templateProjectSchema,
} from "../src/template-project";

const createFixture = async () => {
  const directory = await mkdtemp(
    path.resolve(import.meta.dirname, ".template-project-")
  );
  onTestFinished(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  return directory;
};

describe("local template sources", () => {
  test("renders React Email props and refreshes shared imports without losing explicit text", async () => {
    const directory = await createFixture();
    await writeFile(
      path.resolve(directory, "greeting.ts"),
      'export const greeting = "Hello";\n'
    );
    await writeFile(
      path.resolve(directory, "welcome.tsx"),
      `
      import { Html, Body, Heading, Text } from "react-email";
      import { greeting } from "./greeting";
      export default function Welcome({ firstName }: { firstName: string }) {
        return <Html><Body><Heading>{greeting}, {firstName}</Heading><Text>Your account is ready.</Text></Body></Html>;
      }
    `
    );
    const project = templateProjectSchema.parse({
      projectId: randomUUID(),
      templates: {
        welcome: {
          name: "Welcome",
          source: {
            file: "welcome.tsx",
            kind: "react",
            props: { firstName: "Avery" },
            text: "A plain-text welcome for Avery.",
          },
          subject: "Your account",
        },
      },
    });
    const first = await renderTemplateProject({ directory, project });
    expect(first.welcome?.content).toMatchObject({
      kind: "html",
      text: "A plain-text welcome for Avery.",
    });
    expect(
      first.welcome?.content.kind === "html" && first.welcome.content.html
    ).toContain("Hello");
    expect(
      first.welcome?.content.kind === "html" && first.welcome.content.html
    ).toContain("Avery");
    await writeFile(
      path.resolve(directory, "greeting.ts"),
      'export const greeting = "Good morning";\n'
    );
    const next = await renderTemplateProject({ directory, project });
    expect(
      next.welcome?.content.kind === "html" && next.welcome.content.html
    ).toContain("Good morning");
  });

  test("derives HTML plain text and rejects executable markup before upload", async () => {
    const directory = await createFixture();
    const file = path.resolve(directory, "receipt.html");
    await writeFile(file, "<p>Your receipt is ready.</p>");
    const project = templateProjectSchema.parse({
      projectId: randomUUID(),
      templates: {
        receipt: {
          name: "Receipt",
          source: { file: "receipt.html", kind: "html" },
        },
      },
    });
    const result = await renderTemplateProject({ directory, project });
    expect(
      result.receipt?.content.kind === "html" && result.receipt.content.text
    ).toContain("receipt is ready");
    await writeFile(file, '<script>alert("unsafe")</script><p>Receipt</p>');
    await expect(renderTemplateProject({ directory, project })).rejects.toThrow(
      Error
    );
  });

  test("renders text and editable visual JSON from the manifest directory", async () => {
    const directory = await createFixture();
    await writeFile(
      path.resolve(directory, "reminder.txt"),
      "Your appointment starts tomorrow."
    );
    const design = createEmailDesign();
    design.blocks = [
      {
        align: "left",
        id: randomUUID(),
        text: "Fixture newsletter",
        type: "text",
      },
    ];
    await writeFile(
      path.resolve(directory, "design.json"),
      JSON.stringify(design)
    );
    const project = templateProjectSchema.parse({
      projectId: randomUUID(),
      templates: {
        newsletter: {
          name: "Newsletter",
          source: { file: "design.json", kind: "visual" },
        },
        reminder: {
          name: "Reminder",
          source: { file: "reminder.txt", kind: "text" },
        },
      },
    });
    const result = await renderTemplateProject({
      directory,
      only: "reminder",
      project,
    });
    expect(
      result.reminder?.content.kind === "text" && result.reminder.content.text
    ).toContain("appointment");
    expect(result.newsletter).toBeUndefined();
    const all = await renderTemplateProject({ directory, project });
    expect(renderEmailContent(all.newsletter.content).text).toContain(
      "Fixture newsletter"
    );
    await expect(
      renderTemplateProject({ directory, only: "missing", project })
    ).rejects.toThrow(Error);
  });

  test("rejects malformed configuration and reserved logical identities before loading sources", async () => {
    const directory = await createFixture();
    const file = path.resolve(directory, "quieter.templates.json");
    await writeFile(
      file,
      JSON.stringify({
        projectId: randomUUID(),
        templates: {
          constructor: {
            name: "Unsafe identity",
            source: { file: "does-not-exist.tsx", kind: "react" },
          },
        },
      })
    );
    await expect(readTemplateProject(file)).rejects.toThrow(Error);
    await writeFile(
      file,
      JSON.stringify({
        projectId: randomUUID(),
        templates: {
          welcome: {
            apiKey: "not-a-configuration-field",
            name: "Welcome",
            source: { file: "does-not-exist.tsx", kind: "react" },
          },
        },
      })
    );
    await expect(readTemplateProject(file)).rejects.toThrow(Error);
  });
});
