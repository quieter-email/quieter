import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { arch, tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

export type NativeInstallOperation = {
  args: string[];
  command: string;
  expectedExitCode?: number;
  kind: string;
  verbatim?: boolean;
};
export type RunNativeInstallOperation = (
  operation: NativeInstallOperation
) => Promise<void>;
export type NativeInstallCleanup =
  | { result: "removed"; method: "nsis-uninstall" | "owned-directory" }
  | { result: "retained"; reason: "app-not-stopped" | "cleanup-failed" };

const windowsOS = z.strictObject({
  buildNumber: z.string(),
  caption: z.string(),
  platform: z.literal("win32"),
  productType: z.number().int(),
  version: z.string(),
});
const macOS = z.strictObject({
  buildVersion: z.string(),
  platform: z.literal("darwin"),
  version: z.string(),
});
export type NativeInstallMetadata = {
  architecture: string;
  artifact: { name: string; sha256: string };
  method: "nsis-current-user" | "dmg-owned-app-copy";
  os: z.infer<typeof windowsOS> | z.infer<typeof macOS>;
};

export const createNativeInstallation = ({
  environment,
}: {
  environment: Record<string, string>;
}) => {
  const windows = process.platform === "win32";
  assert.ok(windows || process.platform === "darwin");
  const root = mkdtempSync(
    path.join(realpathSync(tmpdir()), "quieter-installed-")
  );
  const installation = path.join(root, "quieter");
  const mountpoint = path.join(root, "mount");
  const executable = windows
    ? path.join(installation, "quieter.exe")
    : path.join(root, "quieter.app", "Contents", "MacOS", "quieter");
  let mount: "absent" | "attempted" | "attached" | "detached" = "absent";
  let installer: "absent" | "running" | "verifying" | "prepared" = "absent";
  return {
    cleanup: async (
      run: RunNativeInstallOperation,
      appStopped: boolean
    ): Promise<NativeInstallCleanup> => {
      if (!appStopped || installer === "running" || installer === "verifying") {
        return { reason: "app-not-stopped", result: "retained" };
      }
      try {
        let uninstalled = false;
        if (
          windows &&
          installer === "prepared" &&
          lstatSync(installation, { throwIfNoEntry: false }) !== undefined
        ) {
          const uninstaller = path.join(installation, "Uninstall quieter.exe");
          assert.ok(lstatSync(installation).isDirectory());
          assert.ok(lstatSync(uninstaller).isFile());
          await run({
            args: [
              "/currentuser",
              "/S",
              "/KEEP_APP_DATA",
              `_?=${installation}`,
            ],
            command: uninstaller,
            kind: "uninstaller",
            verbatim: true,
          });
          uninstalled = true;
        } else if (mount === "attempted" || mount === "attached") {
          await run({
            args: ["detach", mountpoint],
            command: "hdiutil",
            kind: "detach",
          });
          mount = "detached";
        }
        rmSync(root, { recursive: true });
        return {
          method: uninstalled ? "nsis-uninstall" : "owned-directory",
          result: "removed",
        };
      } catch {
        return { reason: "cleanup-failed", result: "retained" };
      }
    },
    prepare: async (run: RunNativeInstallOperation) => {
      const directory = path.resolve(import.meta.dirname, "../release");
      const extension = windows ? ".exe" : ".dmg";
      const artifacts = readdirSync(directory).filter((name) =>
        name.endsWith(extension)
      );
      assert.equal(artifacts.length, 1);
      const [artifactName] = artifacts;
      assert.ok(artifactName !== undefined && !/[\r\n]/u.test(artifactName));
      const artifact = path.join(directory, artifactName);
      const stat = lstatSync(artifact);
      assert.ok(stat.isFile() && stat.size > 0);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(artifact)) {
        const bytes: unknown = chunk;
        assert.ok(Buffer.isBuffer(bytes));
        hash.update(bytes);
      }
      const os = windows
        ? windowsOS.parse(
            JSON.parse(
              execFileSync(
                "powershell.exe",
                [
                  "-NoProfile",
                  "-NonInteractive",
                  "-Command",
                  '$os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 10; @{ platform = "win32"; caption = $os.Caption; version = $os.Version; buildNumber = $os.BuildNumber; productType = [int]$os.ProductType } | ConvertTo-Json -Compress',
                ],
                { encoding: "utf-8", env: environment, timeout: 30_000 }
              )
            )
          )
        : macOS.parse({
            buildVersion: execFileSync("sw_vers", ["-buildVersion"], {
              encoding: "utf-8",
              env: environment,
              timeout: 10_000,
            }).trim(),
            platform: "darwin",
            version: execFileSync("sw_vers", ["-productVersion"], {
              encoding: "utf-8",
              env: environment,
              timeout: 10_000,
            }).trim(),
          });
      const metadata: NativeInstallMetadata = {
        architecture: arch(),
        artifact: { name: artifactName, sha256: hash.digest("hex") },
        method: windows ? "nsis-current-user" : "dmg-owned-app-copy",
        os,
      };
      if (windows) {
        const safeToInstall: unknown = JSON.parse(
          execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              '@{ active = @(Get-CimInstance Win32_Process -Filter "Name = \'quieter.exe\'" -OperationTimeoutSec 10).Count; registered = (Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\\Software\\Classes\\com.quieter.desktop") -or (Test-Path -LiteralPath "Registry::HKEY_LOCAL_MACHINE\\Software\\Classes\\com.quieter.desktop") } | ConvertTo-Json -Compress',
            ],
            { encoding: "utf-8", env: environment, timeout: 30_000 }
          )
        );
        z.strictObject({
          active: z.literal(0),
          registered: z.literal(false),
        }).parse(safeToInstall);
        installer = "running";
        await run({
          args: ["/currentuser", "/S", `/D=${installation}`],
          command: artifact,
          kind: "installer",
          verbatim: true,
        });
        installer = "verifying";
        const automaticLaunches: unknown = JSON.parse(
          execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "@(Get-CimInstance Win32_Process -Filter \"Name = 'quieter.exe'\" -OperationTimeoutSec 10).Count | ConvertTo-Json -Compress",
            ],
            { encoding: "utf-8", env: environment, timeout: 30_000 }
          )
        );
        assert.equal(
          z.number().int().nonnegative().parse(automaticLaunches),
          0
        );
      } else {
        mkdirSync(mountpoint);
        mount = "attempted";
        await run({
          args: [
            "attach",
            artifact,
            "-readonly",
            "-nobrowse",
            "-mountpoint",
            mountpoint,
          ],
          command: "hdiutil",
          kind: "mount",
        });
        mount = "attached";
        await run({
          args: [
            path.join(mountpoint, "quieter.app"),
            path.join(root, "quieter.app"),
          ],
          command: "ditto",
          kind: "copy",
        });
        await run({
          args: ["detach", mountpoint],
          command: "hdiutil",
          kind: "detach",
        });
        mount = "detached";
      }
      assert.ok(lstatSync(executable).isFile());
      if (windows) {
        installer = "prepared";
      }
      const collisionProbes: NativeInstallOperation[] = windows
        ? [
            {
              args: ["/currentuser", "/S", `/D=${installation}`],
              command: artifact,
              expectedExitCode: 2,
              kind: "running-app-install-denial",
              verbatim: true,
            },
            {
              args: [
                "/currentuser",
                "/S",
                "/KEEP_APP_DATA",
                `_?=${installation}`,
              ],
              command: path.join(installation, "Uninstall quieter.exe"),
              expectedExitCode: 2,
              kind: "running-app-uninstall-denial",
              verbatim: true,
            },
          ]
        : [];
      return { collisionProbes, executable, metadata };
    },
  };
};
