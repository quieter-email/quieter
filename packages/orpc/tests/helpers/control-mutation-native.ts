import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assertLocalDatabaseUrl } from "@quieter/database/local-development";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

// oxlint-disable-next-line typescript/strict-void-return -- Node supports execFile through its custom promisify implementation.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const resourceSchema = z.object({
  Config: z.object({ Labels: z.record(z.string(), z.string()) }),
  HostConfig: z.object({ Memory: z.number() }),
  Id: z.string(),
  NetworkSettings: z.object({
    Ports: z.object({
      "5432/tcp": z.array(
        z.object({ HostIp: z.string(), HostPort: z.string() })
      ),
    }),
  }),
  State: z.object({ Pid: z.number() }),
});

export const createControlMutationNativeFixture = async () => {
  const memory = /MemAvailable:\s+(?<available>\d+)/u.exec(
    await readFile("/proc/meminfo", "utf-8")
  );
  const availableKiB = Number(memory?.groups?.available);
  if (!Number.isFinite(availableKiB) || availableKiB < 3 * 1024 * 1024) {
    throw new Error(
      "Native control checks require at least 3 GiB available memory."
    );
  }
  const exported = await run(
    "vp",
    [
      "exec",
      "drizzle-kit",
      "export",
      "--dialect",
      "postgresql",
      "--schema",
      "./src/schema.ts",
      "--output",
      "json",
    ],
    { cwd: path.join(root, "packages/database"), maxBuffer: 2 * 1024 * 1024 }
  );
  const schema = z
    .object({
      statements: z.array(z.string()),
      status: z.literal("ok"),
    })
    .parse(JSON.parse(exported.stdout));
  const tables = new Set([
    "user",
    "organization",
    "session",
    "member",
    "billingAccountSettings",
    "organizationMailTrackingSettings",
    "managementMutation",
    "managementMutationAuditEvent",
  ]);
  const statements = schema.statements.flatMap((statement) => {
    const table = (
      /^CREATE TABLE "(?<table>[^"]+)"/u.exec(statement) ??
      /^ALTER TABLE "(?<table>[^"]+)"/u.exec(statement) ??
      /CREATE (?:UNIQUE )?INDEX .* ON "(?<table>[^"]+)"/u.exec(statement)
    )?.groups?.table;
    return table === undefined ? [] : [{ statement, table }];
  });
  while (true) {
    const { size } = tables;
    for (const { statement, table } of statements) {
      if (tables.has(table)) {
        for (const match of statement.matchAll(
          /REFERENCES "(?:public"\.")?(?<reference>[^".]+)"/gu
        )) {
          const reference = match.groups?.reference;
          if (reference === undefined) {
            throw new Error("The fixture foreign key could not be resolved.");
          }
          tables.add(reference);
        }
      }
    }
    if (size === tables.size) {
      break;
    }
  }
  const ddl = statements
    .filter(({ table }) => tables.has(table))
    .map(({ statement }) => statement);
  for (const migration of [
    "20261102232937_typical_doctor_octopus",
    "20261102235531_member-lifecycle-admission",
  ]) {
    const source = await readFile(
      path.join(root, "packages/database/drizzle", migration, "migration.sql"),
      "utf-8"
    );
    ddl.push(
      source
        .slice(source.indexOf("CREATE FUNCTION"))
        .replaceAll("--> statement-breakpoint", "")
    );
  }
  const directory = await mkdtemp(
    path.join(tmpdir(), "quieter-control-native-")
  );
  const resourcePath = path.join(directory, "resource.json");
  let containerId: string | null = null;
  let client: ReturnType<typeof postgres> | null = null;
  let second: ReturnType<typeof postgres> | null = null;
  let url: string | null = null;
  const observers = new Set<ReturnType<typeof postgres>>();
  const receipt: {
    state: "preparing" | "running" | "stopped";
    nodePid: number;
    containerId?: string;
    pid?: number;
    port?: number;
    memoryMiB: number;
    availableMiB: number;
    maxConnections: number;
    tables: string[];
  } = {
    availableMiB: Math.floor(availableKiB / 1024),
    maxConnections: 3,
    memoryMiB: 512,
    nodePid: process.pid,
    state: "preparing",
    tables: [...tables].toSorted(),
  };
  const cleanup = async () => {
    await Promise.allSettled([
      ...[client, second]
        .filter((connection) => connection !== null)
        .map(async (connection) => {
          await connection.end({ timeout: 2 });
        }),
      ...[...observers].map(async (connection) => {
        await connection.end({ timeout: 2 });
      }),
    ]);
    if (containerId !== null) {
      const inspected = await run("docker", ["inspect", containerId]);
      const [resource] = z
        .array(resourceSchema.pick({ Config: true, Id: true }))
        .parse(JSON.parse(inspected.stdout));
      if (
        resource?.Id !== containerId ||
        resource.Config.Labels["quieter.fixture"] !== directory
      ) {
        throw new Error("Native control fixture ownership does not match.");
      }
      await run("docker", ["stop", "--time", "3", containerId]);
      await run("docker", ["rm", containerId]);
    }
    receipt.state = "stopped";
    await writeFile(resourcePath, `${JSON.stringify(receipt, null, 2)}\n`);
  };
  try {
    await writeFile(resourcePath, `${JSON.stringify(receipt, null, 2)}\n`);
    const created = await run("docker", [
      "run",
      "--detach",
      "--name",
      `quieter-h127-${process.pid}-${Date.now()}`,
      "--memory",
      "512m",
      "--memory-swap",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "64",
      "--no-healthcheck",
      "--label",
      `quieter.fixture=${directory}`,
      "--label",
      "quieter.program=QUIETER-196",
      "--label",
      "quieter.lane=H",
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_DB=quieter_h127_native",
      "postgres:17-alpine",
      "postgres",
      "-c",
      "max_connections=3",
      "-c",
      "superuser_reserved_connections=0",
      "-c",
      "shared_buffers=64MB",
      "-c",
      "work_mem=4MB",
      "-c",
      "maintenance_work_mem=32MB",
    ]);
    containerId = created.stdout.trim();
    const inspected = await run("docker", ["inspect", containerId]);
    const [resource] = z
      .array(resourceSchema)
      .parse(JSON.parse(inspected.stdout));
    const binding = resource?.NetworkSettings.Ports["5432/tcp"][0];
    if (
      resource === undefined ||
      binding === undefined ||
      binding.HostIp !== "127.0.0.1" ||
      resource.HostConfig.Memory !== 512 * 1024 * 1024
    ) {
      throw new Error(
        "Native control fixture is not bounded to loopback and 512 MiB."
      );
    }
    url = `postgres://postgres:postgres@127.0.0.1:${binding.HostPort}/quieter_h127_native`;
    assertLocalDatabaseUrl(url, "quieter_h127_native");
    const connectionOptions = {
      connect_timeout: 2,
      fetch_types: false,
      idle_timeout: 0,
      max: 1,
      prepare: false,
    };
    client = postgres(url, connectionOptions);
    second = postgres(url, connectionOptions);
    receipt.state = "running";
    receipt.containerId = containerId;
    receipt.pid = resource.State.Pid;
    receipt.port = Number(binding.HostPort);
    await writeFile(resourcePath, `${JSON.stringify(receipt, null, 2)}\n`);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await client`select 1`;
        ready = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!ready) {
      throw new Error("Native control fixture did not start.");
    }
    await client.unsafe(ddl.join("\n"));
    const primary = client;
    const secondary = second;
    const connectionUrl = url;
    return {
      cleanup,
      database: drizzle({ client: primary }),
      async observer() {
        const currentMemory = /MemAvailable:\s+(?<available>\d+)/u.exec(
          await readFile("/proc/meminfo", "utf-8")
        );
        const available = Number(currentMemory?.groups?.available);
        if (!Number.isFinite(available) || available < 3 * 1024 * 1024) {
          throw new Error(
            "Native control races require at least 3 GiB available memory."
          );
        }
        if (observers.size > 0) {
          throw new Error("Only one deliberate third connection is allowed.");
        }
        const connection = postgres(connectionUrl, connectionOptions);
        observers.add(connection);
        return {
          async close() {
            await connection.end({ timeout: 2 });
            observers.delete(connection);
          },
          sql: connection,
        };
      },
      resourcePath,
      secondDatabase: drizzle({ client: secondary }),
      secondSql: secondary,
      sql: primary,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
