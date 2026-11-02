#!/usr/bin/env node
/* oxlint-disable node/no-sync -- Sync names the remote workflow; all filesystem work is asynchronous. */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createCliEnv } from "@quieter/env/cli";

import { Quieter, QuieterApiError } from "./index";
import { readTemplateProject, renderTemplateProject } from "./template-project";
import { openTemplateSync } from "./template-sync";

const help = `Edit emails locally and sync them to your team's Templates library.

  quieter templates init [directory]
  quieter templates push [--config file] [--only key]
  quieter templates dev [--config file] [--only key]
  quieter templates link <key> <template-id> [--config file]

Options:
  --config file       Project manifest, defaults to quieter.templates.json.
  --only key          Sync one logical template from the manifest.
  --base-url origin   API origin, defaults to https://quieter.email.
  --env-file file     Load an explicit, ignored local environment file.
  --help              Show this help.

Set QUIETER_MAIL_API_KEY to a team API key with templates:read and
templates:write. QUIETER_MAIL_API_URL optionally sets the API origin.
React sources need react, react-dom, react-email, and @react-email/render.
Code runs locally. Sync saves templates. Send through campaign review in Quieter.
Keep .quieter/ state to preserve template bindings and recover interrupted writes.
`;

const initializeProject = async (directory: string): Promise<void> => {
  const config = path.resolve(directory, "quieter.templates.json");
  const source = path.resolve(directory, "emails/welcome.tsx");
  for (const file of [config, source]) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Check every destination before creating any file.
      await stat(file);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    throw new Error(
      `Refusing to replace ${file}. Choose an empty destination.`
    );
  }
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(
    config,
    `${JSON.stringify(
      {
        projectId: randomUUID(),
        templates: {
          welcome: {
            name: "Welcome",
            source: {
              file: "emails/welcome.tsx",
              kind: "react",
              props: { firstName: "Alex" },
            },
            subject: "Welcome aboard",
          },
        },
      },
      null,
      2
    )}\n`,
    { flag: "wx" }
  );
  await writeFile(
    source,
    `import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "react-email";

export default function Welcome({ firstName }: { firstName: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your account is ready. Welcome aboard.</Preview>
      <Body style={{ backgroundColor: "#f4f4f5", fontFamily: "Arial, sans-serif", margin: 0, padding: "32px 12px" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: "12px", margin: "0 auto", maxWidth: "560px", padding: "32px" }}>
          <Heading style={{ color: "#18181b", fontSize: "28px", lineHeight: "34px", margin: "0 0 16px" }}>Welcome, {firstName}</Heading>
          <Text style={{ color: "#45454f", fontSize: "16px", lineHeight: "24px", margin: "0 0 24px" }}>Your first email starts here. Edit this file to make it yours.</Text>
          <Button href="https://example.com" style={{ backgroundColor: "#305cde", borderRadius: "8px", color: "#ffffff", fontSize: "16px", padding: "14px 20px", textDecoration: "none" }}>Get started</Button>
        </Container>
      </Body>
    </Html>
  );
}
`,
    { flag: "wx" }
  );
  const ignorePath = path.resolve(directory, ".gitignore");
  let ignored = "";
  try {
    ignored = await readFile(ignorePath, "utf-8");
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  const missing = [
    ".quieter/",
    ".env.local",
    ".env.template-sync.local",
  ].filter((entry) => !ignored.split(/\r?\n/u).includes(entry));
  if (missing.length > 0) {
    await appendFile(ignorePath, `\n${missing.join("\n")}\n`);
  }
  process.stdout.write(
    `Created ${config} and emails/welcome.tsx.\nInstall react, react-dom, react-email, and @react-email/render in this project.\nSet QUIETER_MAIL_API_KEY, then run quieter templates dev --config ${JSON.stringify(config)}.\n`
  );
};

const run = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      config: { type: "string" },
      "env-file": { type: "string" },
      help: { short: "h", type: "boolean" },
      only: { type: "string" },
    },
  });
  if (values.help === true || positionals.length === 0) {
    process.stdout.write(help);
    return;
  }
  const [group, command, ...arguments_] = positionals;
  if (
    group !== "templates" ||
    !["init", "push", "dev", "link"].includes(command ?? "")
  ) {
    throw new Error(
      "Use quieter templates init, push, dev, or link. Run with --help for usage."
    );
  }
  if (command === "init") {
    if (
      arguments_.length > 1 ||
      values.config ||
      values.only ||
      values["base-url"] ||
      values["env-file"]
    ) {
      throw new Error(
        "Use quieter templates init [directory] without sync options."
      );
    }
    await initializeProject(path.resolve(arguments_[0] ?? "."));
    return;
  }
  if (
    (command === "link" ? arguments_.length !== 2 : arguments_.length !== 0) ||
    (command === "link" && values.only !== undefined)
  ) {
    throw new Error(
      "Use quieter templates link <key> <template-id>, or push/dev with named options. Run with --help for usage."
    );
  }
  if (values["env-file"] !== undefined) {
    process.loadEnvFile(path.resolve(values["env-file"]));
  }
  const env = createCliEnv();
  const apiKey = env.QUIETER_MAIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set QUIETER_MAIL_API_KEY to a team API key with templates:read and templates:write. Use --env-file for an ignored local env file."
    );
  }
  const origin = new URL(
    values["base-url"] ?? env.QUIETER_MAIL_API_URL ?? "https://quieter.email"
  );
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    origin.hostname
  );
  if (
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && loopback)) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error(
      "The API URL must be an HTTPS origin, or a loopback HTTP origin, without credentials, a path, query, or fragment."
    );
  }
  const configPath = path.resolve(values.config ?? "quieter.templates.json");
  const directory = path.dirname(configPath);
  const project = await readTemplateProject(configPath);
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const client = new Quieter({
    apiKey,
    baseUrl: origin.origin,
    fetch: async (input, init) =>
      await fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(30_000),
        ]),
      }),
  });
  let session: Awaited<ReturnType<typeof openTemplateSync>> | undefined;
  const sync = async (): Promise<{ failed: boolean; retry: boolean }> => {
    const current = await readTemplateProject(configPath);
    if (current.projectId !== project.projectId) {
      throw new Error(
        "The project identity changed. Restart the command to select a different project."
      );
    }
    const templates = await renderTemplateProject({
      directory,
      only: values.only,
      project: current,
    });
    session ??= await openTemplateSync({
      client,
      directory,
      projectId: project.projectId,
      signal: controller.signal,
    });
    let failed = false;
    let retry = false;
    for (const [key, fields] of Object.entries(templates)) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- The journal and remote revisions have one writer.
        const result = await session.syncTemplate({
          fields,
          key,
          signal: controller.signal,
        });
        const url = new URL(
          `/templates/${encodeURIComponent(result.template.id)}`,
          origin
        );
        url.searchParams.set("organizationId", result.template.organizationId);
        process.stdout.write(
          `${key}: ${result.changed ? "synced" : "up to date"} ${url.href}\n`
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        failed = true;
        retry ||=
          error instanceof TypeError ||
          (error instanceof Error && error.name === "TimeoutError") ||
          (error instanceof QuieterApiError &&
            (error.status >= 500 || [408, 429].includes(error.status)));
        const message =
          error instanceof Error ? error.message : "Template sync failed.";
        process.stderr.write(
          `${key}: ${message.replaceAll(apiKey, "[redacted]")}\n`
        );
      }
    }
    return { failed, retry };
  };
  try {
    if (command === "link") {
      const [key, templateId] = arguments_;
      if (
        key === undefined ||
        templateId === undefined ||
        !Object.hasOwn(project.templates, key)
      ) {
        throw new Error(
          "Choose a logical key that exists in the project manifest."
        );
      }
      session = await openTemplateSync({
        client,
        directory,
        projectId: project.projectId,
        signal: controller.signal,
      });
      const template = await session.linkTemplate({
        key,
        signal: controller.signal,
        templateId,
      });
      process.stdout.write(
        `Linked ${key} to ${template.id}. The next push or dev sync applies your local content to this template.\n`
      );
      return;
    }
    if (command === "push") {
      const result = await sync();
      if (result.failed) {
        process.exitCode = 1;
      }
      return;
    }
    const { watch } = await import("chokidar");
    const watcher = watch(directory, {
      awaitWriteFinish: { pollInterval: 50, stabilityThreshold: 150 },
      followSymlinks: false,
      ignoreInitial: true,
      ignored:
        /(?:^|[/\\])(?:node_modules|\.git|\.quieter|dist|build|coverage|\.next|\.sst|\.wrangler)(?:[/\\]|$)/u,
    });
    let ready = false;
    let queued = false;
    let running: Promise<void> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const schedule = () => {
      queued = true;
      if (!ready || running !== undefined || controller.signal.aborted) {
        return;
      }
      running = (async () => {
        try {
          while (queued && !controller.signal.aborted) {
            queued = false;
            clearTimeout(retryTimer);
            try {
              // oxlint-disable-next-line no-await-in-loop -- Coalesce filesystem events behind the active sync.
              const result = await sync();
              if (!result.failed) {
                retries = 0;
              }
              if (result.retry && retries < 5) {
                retries += 1;
                retryTimer = setTimeout(schedule, 1000 * 2 ** retries);
              }
            } catch (error) {
              if (!controller.signal.aborted) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Template sync failed.";
                process.stderr.write(
                  `${message.replaceAll(apiKey, "[redacted]")}\n`
                );
                if (
                  (error instanceof TypeError ||
                    (error instanceof Error && error.name === "TimeoutError") ||
                    (error instanceof QuieterApiError &&
                      (error.status >= 500 ||
                        [408, 429].includes(error.status)))) &&
                  retries < 5
                ) {
                  retries += 1;
                  retryTimer = setTimeout(schedule, 1000 * 2 ** retries);
                }
              }
            }
          }
        } finally {
          running = undefined;
        }
      })();
    };
    watcher.on("all", () => {
      retries = 0;
      schedule();
    });
    watcher.on("error", (error) => {
      const message =
        error instanceof Error ? error.message : "The file watcher stopped.";
      process.stderr.write(
        `File watching failed: ${message.replaceAll(apiKey, "[redacted]")}\n`
      );
      process.exitCode = 1;
      controller.abort();
    });
    try {
      await once(watcher, "ready", { signal: controller.signal });
      ready = true;
      process.stdout.write(
        `Watching ${directory}. Save a source file to sync. Press Ctrl+C to stop.\n`
      );
      schedule();
      if (!controller.signal.aborted) {
        await once(controller.signal, "abort");
      }
    } finally {
      clearTimeout(retryTimer);
      await watcher.close();
      await running;
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      const message =
        error instanceof Error ? error.message : "Template command failed.";
      throw new Error(message.replaceAll(apiKey, "[redacted]"), {
        cause: error,
      });
    }
  } finally {
    controller.abort();
    await session?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
};

try {
  await run();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Template command failed."}\n`
  );
  process.exitCode = 1;
}
