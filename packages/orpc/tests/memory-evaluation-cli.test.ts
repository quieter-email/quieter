import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { memoryRecallScenarios } from "../evals/memory-recall-scenarios";

const servers: Server[] = [];
const directories: string[] = [];
// oxlint-disable-next-line typescript/strict-void-return -- Node execFile provides the callback signature consumed by promisify.
const execute = promisify(execFile);

const listen = async (handler: RequestListener) => {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The fixture requires an assigned loopback port.");
  }
  return `http://127.0.0.1:${address.port}`;
};

const runCommand = async (
  args: string[],
  env: NodeJS.ProcessEnv = process.env
) => {
  try {
    return {
      failed: false,
      ...(await execute("vp", args, {
        encoding: "utf8",
        env,
        maxBuffer: 1_000_000,
        timeout: 20_000,
      })),
    };
  } catch (error) {
    return {
      failed: true,
      ...z
        .object({
          stderr: z.string().default(""),
          stdout: z.string().default(""),
        })
        .parse(error),
    };
  }
};

describe("memory evaluation command boundaries", () => {
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server[Symbol.asyncDispose]();
    }
    for (const directory of directories.splice(0)) {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resuming through the actual CLI reads the retained corpus without ingestion", async () => {
    const scenario = memoryRecallScenarios.find(
      (entry) => entry.id === "recipient-and-general-voice"
    );
    if (!scenario) {
      throw new Error("The shared recipient scenario is missing.");
    }
    const ingested: string[] = [];
    const requested: string[] = [];
    const baseUrl = await listen((request, response) => {
      const pathname = request.url?.split("?")[0] ?? "";
      requested.push(pathname);
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") {
        const key = pathname.split("/").at(-1);
        const fact = scenario.facts.find((entry) => entry.key === key);
        if (fact) {
          response.end(
            JSON.stringify({
              content: fact.content,
              id: fact.key,
              system: { status: "done" },
            })
          );
          return;
        }
      }
      if (pathname.endsWith("/document")) {
        ingested.push(pathname);
        response.writeHead(500).end("{}");
      } else if (pathname.endsWith("/list/memories")) {
        response.end(JSON.stringify({ memories: [] }));
      } else if (pathname.endsWith("/profile")) {
        response.end(JSON.stringify({ profile: { dynamic: [], static: [] } }));
      } else if (pathname.endsWith("/search")) {
        response.end(JSON.stringify({ results: [] }));
      } else {
        response.writeHead(404).end("{}");
      }
    });
    const directory = await mkdtemp(path.join(tmpdir(), "memory-cli-"));
    directories.push(directory);
    const keyPath = path.join(directory, "api-key");
    const outputPath = path.join(directory, "report.json");
    await writeFile(keyPath, "synthetic-local-key", { mode: 0o600 });
    const resumeRunId = crypto.randomUUID();
    const result = await runCommand([
      "run",
      "memory:compare",
      "--api-key-file",
      keyPath,
      "--base-url",
      baseUrl,
      "--embedding-model",
      "synthetic-embedding",
      "--extraction-model",
      "synthetic-extractor",
      "--service-version",
      "synthetic-server",
      "--scenario",
      scenario.id,
      "--resume-run-id",
      resumeRunId,
      "--output",
      outputPath,
    ]);
    expect(result).toMatchObject({ failed: false });
    expect(ingested).toHaveLength(0);
    expect(requested.length).toBeGreaterThan(0);
    const report: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    expect(report).toMatchObject({ runId: resumeRunId, status: "complete" });
  }, 30_000);

  test("a rejected database target never receives setup or cleanup traffic", async () => {
    let connections = 0;
    const server = createTcpServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("The fixture requires an assigned loopback port.");
      }
      const result = await runCommand(
        [
          "test",
          "run",
          "--maxWorkers=1",
          "--hookTimeout=1000",
          "packages/orpc/tests/memory-recall.eval.test.ts",
        ],
        {
          ...process.env,
          MEMORY_EVAL_REPORT: "",
          MEMORY_EVAL_SEMANTIC: "false",
          MIGRATION_TEST_DATABASE_URL: `postgresql://postgres@127.0.0.1:${address.port}/rejected_target`,
        }
      );
      expect(result).toMatchObject({ failed: true });
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /requires disposable loopback/u
      );
      expect(connections).toBe(0);
    } finally {
      await server[Symbol.asyncDispose]();
    }
  }, 30_000);
});
