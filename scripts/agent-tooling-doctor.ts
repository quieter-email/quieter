import { spawnSync } from "node:child_process";

const required = new Map([
  ["sentry", "oauth"],
  ["planetscale", "oauth"],
  ["cloudflare", "oauth"],
  ["cloudflare-bindings", "oauth"],
  ["cloudflare-builds", "oauth"],
  ["cloudflare-observability", "oauth"],
  ["aws-mcp", "provider"],
  ["polar", "oauth"],
  ["polar_sandbox", "oauth"],
]);
const result = spawnSync("codex", ["mcp", "list", "--json"], {
  encoding: "utf-8",
  timeout: 60_000,
  windowsHide: true,
});
if (result.error || result.status !== 0) {
  throw new Error(
    "Could not read Codex MCP inventory. Check that Codex CLI is installed and responds to codex mcp list. Raw output is withheld because configuration can contain credentials."
  );
}

let parsed: unknown;
try {
  parsed = JSON.parse(result.stdout);
} catch {
  throw new Error("Codex returned an invalid MCP inventory.");
}
if (!Array.isArray(parsed)) {
  throw new TypeError("Codex returned an unexpected MCP inventory shape.");
}
const entries: unknown[] = parsed;
const configured = new Map<string, { enabled: boolean; auth: string }>();
for (const entry of entries) {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "name" in entry &&
    typeof entry.name === "string" &&
    "enabled" in entry &&
    "auth_status" in entry &&
    typeof entry.auth_status === "string"
  ) {
    configured.set(entry.name, {
      auth: entry.auth_status,
      enabled: entry.enabled === true,
    });
  }
}

let failures = 0;
for (const [name, authentication] of required) {
  const server = configured.get(name);
  let state = "MISSING";
  if (server) {
    if (!server.enabled) {
      state = "DISABLED";
    } else if (authentication === "provider") {
      state = "CONFIGURED, verify provider credentials with a read call";
    } else if (server.auth === "o_auth") {
      state = "OAUTH SAVED, verify a read call in the active task";
    } else {
      state = "AUTHENTICATION REQUIRED";
    }
  }
  if (
    server?.enabled !== true ||
    (authentication === "oauth" && server.auth !== "o_auth")
  ) {
    failures += 1;
  }
  process.stdout.write(`${name}: ${state}\n`);
}
process.stdout.write(
  "\nConfiguration checks only. Saved OAuth may have expired. This does not test tool discovery, provider permissions, PostHog's app connector, or application features. Complete the read probes in docs/agent-tooling.md.\n"
);
process.exitCode = failures > 0 ? 1 : 0;
