import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";
import { deploymentManifestSchema } from "@quieter/env/deployment";
import {
  diagnoseLocalEnv,
  parseEnvFile,
  serializeEnvFile,
} from "@quieter/env/local-doctor";
import { z } from "zod";

const projectRoot = path.resolve(import.meta.dirname, "..");
const [currentArgument, previousOrPort, portArgument] = process.argv.slice(2);
if (currentArgument === "--help" || currentArgument === "-h") {
  process.stdout.write(
    "Usage: vp run dev:skew <current-output-directory> [previous-output-directory] [port]\nSnapshots must contain v0/workers/default with its bundle, assets, and worker.config.json.\n"
  );
} else {
  if (!currentArgument) {
    throw new Error(
      "Provide a complete .cloudflare/output snapshot. Run dev:skew --help for usage."
    );
  }
  const secondIsPort =
    previousOrPort !== undefined && /^\d+$/u.test(previousOrPort);
  if (secondIsPort && portArgument !== undefined) {
    throw new Error("A previous snapshot must precede an explicit port.");
  }
  const previousArgument = secondIsPort ? undefined : previousOrPort;
  const explicitPort = secondIsPort ? previousOrPort : portArgument;
  const requestedPort =
    explicitPort === undefined
      ? 0
      : z.coerce.number().int().min(1).max(65_535).parse(explicitPort);

  const readSnapshot = async (argument: string) => {
    const directory = await realpath(path.resolve(projectRoot, argument));
    const worker = path.join(directory, "v0/workers/default");
    const configuration = z
      .object({
        manifest: z.object({ mainModule: z.string().min(1) }),
      })
      .parse(
        JSON.parse(
          await readFile(path.join(worker, "worker.config.json"), "utf-8")
        )
      );
    const bundle = path.join(worker, "bundle");
    const main = path.resolve(bundle, configuration.manifest.mainModule);
    const relative = path.relative(bundle, main);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        "The snapshot's server entry must stay inside its bundle."
      );
    }
    const assets = path.join(worker, "assets");
    const marker = await readFile(
      path.join(assets, "assets/build-id.txt"),
      "utf-8"
    );
    const buildId = deploymentManifestSchema.shape.current.shape.buildId.parse(
      marker.trim()
    );
    const [mainStats, assetsStats] = await Promise.all([
      stat(main),
      stat(assets),
    ]);
    if (!mainStats.isFile() || !assetsStats.isDirectory()) {
      throw new Error("The snapshot is incomplete.");
    }
    return { assets, buildId, directory, main };
  };

  const current = await readSnapshot(currentArgument);
  const previous =
    previousArgument === undefined
      ? null
      : await readSnapshot(previousArgument);
  if (
    previous !== null &&
    (previous.directory === current.directory ||
      previous.buildId === current.buildId)
  ) {
    throw new Error(
      "Current and previous snapshots need different directories and build identifiers."
    );
  }

  const listener = createServer();
  listener.listen(requestedPort, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (address === null || typeof address === "string") {
    throw new Error("Cannot reserve a local preview port.");
  }
  const { port } = address;
  const listenerClosed = once(listener, "close");
  listener.close();
  await listenerClosed;
  const origin = `http://127.0.0.1:${port}`;
  const values = parseEnvFile(path.join(projectRoot, ".env.local"));
  values.set("BETTER_AUTH_URL", origin);
  values.set("BETTER_AUTH_TRUSTED_ORIGINS", origin);
  const errors = diagnoseLocalEnv(values);
  if (errors.length > 0) {
    throw new Error(`Local environment is not isolated:\n${errors.join("\n")}`);
  }
  values.delete("DATABASE_MIGRATION_URL");
  for (const key of values.keys()) {
    if (
      key.startsWith("SENTRY_") ||
      key.startsWith("VITE_SENTRY_") ||
      key.startsWith("VITE_PUBLIC_POSTHOG_")
    ) {
      values.delete(key);
    }
  }
  values.set("NODE_ENV", "development");
  values.set("QUIETER_GMAIL_AI_AUTOMATION_ENABLED", "false");
  values.set("QUIETER_LOCAL_GMAIL_WATCH_OWNER", "production");
  values.set("QUIETER_LOCAL_PROVIDER_MODE", "observe");
  const previewDirectory = path.join(
    projectRoot,
    ".scratch",
    `skew-preview-${port}`
  );
  const base = {
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: ["nodejs_compat"],
  };
  const configs: string[] = [];
  for (const [slot, snapshot] of [
    ["a", current],
    ["b", previous],
  ] as const) {
    if (snapshot === null) {
      continue;
    }
    const directory = path.join(previewDirectory, slot);
    await mkdir(directory, { recursive: true });
    const config = path.join(directory, "wrangler.json");
    await writeFile(
      config,
      JSON.stringify(
        {
          ...base,
          assets: { binding: "ASSETS", directory: snapshot.assets },
          main: snapshot.main,
          name: `quieter-skew-${port}-${slot}`,
          r2_buckets: [
            {
              binding: "LocalMailStorage",
              bucket_name: `quieter-skew-${port}-${slot}`,
              remote: false,
            },
          ],
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(directory, ".dev.vars"),
      serializeEnvFile(values),
      {
        mode: 0o600,
      }
    );
    configs.push(config);
  }
  const manifest = deploymentManifestSchema.parse({
    current: { buildId: current.buildId, slot: "a" },
    previous:
      previous === null
        ? null
        : {
            buildId: previous.buildId,
            expiresAt: Date.now() + 12 * 60 * 60 * 1000,
            slot: "b",
          },
  });
  const routerDirectory = path.join(previewDirectory, "router");
  await mkdir(routerDirectory, { recursive: true });
  const routerConfig = path.join(routerDirectory, "wrangler.json");
  await writeFile(
    routerConfig,
    JSON.stringify(
      {
        ...base,
        main: path.join(projectRoot, "packages/cloudflare/src/web-router.ts"),
        name: `quieter-skew-${port}-router`,
        services: [
          { binding: "WebReleaseA", service: `quieter-skew-${port}-a` },
          {
            binding: "WebReleaseB",
            service: `quieter-skew-${port}-${previous === null ? "a" : "b"}`,
          },
        ],
        vars: { QUIETER_WEB_DEPLOYMENT: JSON.stringify(manifest) },
      },
      null,
      2
    )
  );
  const child = spawn(
    process.platform === "win32" ? "vp.exe" : "vp",
    [
      "exec",
      "wrangler",
      "dev",
      "-c",
      routerConfig,
      ...configs.flatMap((config) => ["-c", config]),
      "--ip",
      "127.0.0.1",
      "--local",
      "--inspector-port",
      "0",
      "--port",
      String(port),
      "--log-level",
      "warn",
    ],
    {
      cwd: path.join(projectRoot, "apps/web"),
      detached: process.platform !== "win32",
      stdio: "inherit",
      windowsHide: true,
    }
  );
  const stop = () => {
    if (
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return;
    }
    if (process.platform === "win32") {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await once(child, "spawn");
  await writeFile(
    path.join(previewDirectory, "preview.pid"),
    String(child.pid)
  );
  process.stdout.write(
    `Skew preview ${origin}, PID ${child.pid}. Ctrl+C stops its process tree.\nEdit ${routerConfig} to promote or expire a release.\n`
  );
  await once(child, "exit");
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  process.exitCode = child.exitCode ?? 1;
}
