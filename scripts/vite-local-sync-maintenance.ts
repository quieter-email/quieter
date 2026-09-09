import path from "node:path";

import { assertLocalEnvFile, parseEnvFile } from "@quieter/env/local-doctor";
import { createServerEnv } from "@quieter/env/server";
import type { Plugin } from "vite-plus";

export const localSyncMaintenance = (workspaceRoot: string): Plugin => ({
  configureServer(server) {
    const envPath = path.join(workspaceRoot, ".env.local");
    assertLocalEnvFile(envPath);
    const env = createServerEnv(Object.fromEntries(parseEnvFile(envPath)));
    if (
      env.QUIETER_DEPLOYMENT_ENV !== "local" ||
      env.QUIETER_MAIL_SYNC_ENABLED !== true
    ) {
      return;
    }
    const url = new URL(env.MAIL_SYNC_URL ?? "http://127.0.0.1:8788");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.port !== "8788"
    ) {
      throw new Error(
        "Local sync maintenance requires the loopback sync Worker on port 8788."
      );
    }
    let running = false;
    let failed = false;
    const controller = new AbortController();
    const maintain = async () => {
      if (running || controller.signal.aborted) {
        return;
      }
      running = true;
      try {
        const response = await fetch(new URL("/cdn-cgi/local/scheduled", url), {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(45_000),
          ]),
        });
        await response.body?.cancel();
        if (!response.ok) {
          throw new Error(
            `Local sync maintenance returned ${response.status}.`
          );
        }
        if (failed) {
          server.config.logger.info("Local mail sync maintenance recovered.");
        }
        failed = false;
      } catch {
        if (!controller.signal.aborted && !failed) {
          server.config.logger.warn(
            "Local mail sync maintenance is unavailable. Start vp run dev:full; retrying automatically."
          );
        }
        failed = true;
      } finally {
        running = false;
      }
    };
    const initial = setTimeout(() => {
      void maintain();
    }, 10_000);
    const interval = setInterval(() => {
      void maintain();
    }, 60_000);
    server.httpServer?.once("close", () => {
      controller.abort();
      clearTimeout(initial);
      clearInterval(interval);
    });
  },
  name: "local-sync-maintenance",
});
