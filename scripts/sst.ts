import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const passThroughCommands = new Set(["--help", "-h", "help", "version", "upgrade", "telemetry"]);
const windowsArmRandomProviderVersion = "4.16.6";
const windowsArmRandomProviderDir = `resource-random-v${windowsArmRandomProviderVersion}`;

const hasOption = (name: string) => args.some((arg) => arg === name || arg.startsWith(`${name}=`));
const shouldUseAppDefaults = args.length > 0 && !passThroughCommands.has(args[0] ?? "");

const runOrThrow = (command: string, commandArgs: string[], options?: { cwd?: string }) => {
  const result = spawnSync(command, commandArgs, {
    cwd: options?.cwd,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
};

const ensureWindowsArmRandomProvider = () => {
  if (process.platform !== "win32" || process.arch !== "arm64") {
    return;
  }

  const appData = process.env.APPDATA;

  if (!appData) {
    throw new Error("APPDATA is required to locate SST's Pulumi plugin cache on Windows ARM64.");
  }

  const pluginsDir = resolve(appData, "sst", "plugins");
  const providerDir = resolve(pluginsDir, windowsArmRandomProviderDir);
  const providerExe = resolve(providerDir, "pulumi-resource-random.exe");

  if (existsSync(providerExe)) {
    return;
  }

  const providerUrl =
    `https://get.pulumi.com/releases/plugins/pulumi-resource-random-v${windowsArmRandomProviderVersion}-windows-amd64.tar.gz`;
  const tempDir = mkdtempSync(resolve(tmpdir(), "quieter-sst-random-provider-"));
  const archivePath = resolve(tempDir, "pulumi-resource-random.tar.gz");
  const extractDir = resolve(tempDir, "extract");

  try {
    mkdirSync(extractDir, { recursive: true });

    console.warn(
      [
        `SST/Pulumi does not publish pulumi-resource-random v${windowsArmRandomProviderVersion} for windows-arm64.`,
        "Installing the windows-amd64 provider into the local SST plugin cache for Windows ARM64.",
      ].join(" "),
    );

    runOrThrow("curl.exe", ["-L", "-o", archivePath, providerUrl]);
    runOrThrow("tar.exe", ["-xzf", archivePath, "-C", extractDir]);

    rmSync(providerDir, { force: true, recursive: true });
    mkdirSync(pluginsDir, { recursive: true });
    renameSync(extractDir, providerDir);
    writeFileSync(`${providerDir}.lock`, "");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
};

ensureWindowsArmRandomProvider();

const sstArgs = [...args];

if (shouldUseAppDefaults && !hasOption("--config")) {
  sstArgs.push("--config", "sst.config.ts");
}

if (shouldUseAppDefaults && !hasOption("--stage")) {
  sstArgs.push("--stage", "mail-dev");
}

const result = spawnSync("bunx", ["sst", ...sstArgs], {
  cwd: repoRoot,
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
