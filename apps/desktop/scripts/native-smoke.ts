import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { release, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { _electron } from "playwright-core";
import type { ElectronApplication } from "playwright-core";

import { createNativeInstallation } from "./native-install.ts";
import type {
  NativeInstallCleanup,
  NativeInstallMetadata,
  NativeInstallOperation,
  RunNativeInstallOperation,
} from "./native-install.ts";

type SmokeReport = {
  kind: "packaged-native-smoke";
  installation?: NativeInstallMetadata;
  installationCleanup?: NativeInstallCleanup;
  installationProcesses: {
    exitCode: number | null;
    kind: string;
    pid: number | null;
    stopped: boolean;
  }[];
  checkoutRevision: string;
  platform: NodeJS.Platform;
  architecture: string;
  osRelease: string;
  fixtureRequests: number;
  unexpectedFixtureRequests: number;
  fixturePort: number | null;
  primaryPid: number | null;
  keyringPid: number | null;
  windowManagerPid: number | null;
  cases: string[];
  result: "passed" | "failed";
  stage: string;
  failureName?: string;
  electronVersion?: string;
  storageBackend?: string;
  associatedProcesses?: number;
  cleanup: {
    applicationStopped: boolean;
    keyringStopped: boolean;
    windowManagerStopped: boolean;
    applicationExit: "not-started" | "graceful" | "forced";
  };
};

const waitUntil = async (
  check: () => boolean | Promise<boolean>,
  timeout = 15_000
): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(100);
  }
  throw new Error("Native candidate did not reach the expected state.");
};

const stopChild = async (child: ChildProcess): Promise<boolean> => {
  const { pid } = child;
  if (
    pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return true;
  }
  const exited = once(child, "exit");
  const signalTree = (signal: "SIGTERM" | "SIGKILL"): void => {
    if (process.platform === "win32") {
      execFileSync(
        "taskkill",
        ["/pid", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        { stdio: "ignore" }
      );
    } else {
      process.kill(-pid, signal);
    }
  };
  try {
    signalTree("SIGTERM");
    await Promise.race([exited, delay(5000, null, { ref: false })]);
    if (child.exitCode !== null || child.signalCode !== null) {
      return true;
    }
    signalTree("SIGKILL");
    await Promise.race([exited, delay(5000, null, { ref: false })]);
  } catch {
    await Promise.race([exited, delay(5000, null, { ref: false })]);
  }
  return child.exitCode !== null || child.signalCode !== null;
};

const findExecutable = async (): Promise<string> => {
  const directory = path.join(import.meta.dirname, "../release");
  const pattern =
    process.platform === "darwin"
      ? /^mac(?:-[a-z0-9]+)?$/u
      : new RegExp(
          `^${process.platform === "win32" ? "win" : "linux"}(?:-[a-z0-9]+)?-unpacked$`,
          "u"
        );
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries.filter(
    (entry) => entry.isDirectory() && pattern.test(entry.name)
  );
  assert.equal(
    directories.length,
    1,
    "Select one packaged candidate executable."
  );
  const [candidate] = directories;
  assert.ok(candidate !== undefined);
  return path.join(
    directory,
    candidate.name,
    ...(process.platform === "darwin"
      ? ["quieter.app", "Contents", "MacOS", "quieter"]
      : [process.platform === "win32" ? "quieter.exe" : "quieter"])
  );
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      executable: { type: "string" },
      help: { type: "boolean" },
      "install-candidate": { type: "boolean" },
      output: { type: "string" },
      revision: { type: "string" },
    },
  });
  if (values.help === true) {
    process.stdout.write(
      "Usage: vp run @quieter/desktop#test:native --revision <full-SHA> --output <evidence-directory> [--executable <packaged-executable> | --install-candidate]\n"
    );
    return;
  }
  assert.ok(values.output && values.revision);
  assert.ok(/^[a-f0-9]{40}$/u.test(values.revision));
  const repository = path.resolve(import.meta.dirname, "../../..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf-8",
  }).trim();
  assert.equal(
    revision,
    values.revision,
    "Candidate checkout revision changed."
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: repository,
      encoding: "utf-8",
    }).trim(),
    "",
    "Native evidence requires a clean checkout."
  );
  assert.ok(
    !(values.executable !== undefined && values["install-candidate"] === true)
  );
  const selection:
    | { kind: "install" }
    | { executable: string; kind: "existing" } =
    values["install-candidate"] === true
      ? { kind: "install" }
      : {
          executable: path.resolve(
            values.executable ?? (await findExecutable())
          ),
          kind: "existing",
        };
  const output = path.resolve(values.output);
  await mkdir(output, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "quieter-native-smoke-"));
  await mkdir(path.join(profile, "runtime"), { mode: 0o700 });
  const report: SmokeReport = {
    architecture: process.arch,
    cases: [],
    checkoutRevision: revision,
    cleanup: {
      applicationExit: "not-started",
      applicationStopped: true,
      keyringStopped: true,
      windowManagerStopped: true,
    },
    fixturePort: null,
    fixtureRequests: 0,
    installationProcesses: [],
    keyringPid: null,
    kind: "packaged-native-smoke",
    osRelease: release(),
    platform: process.platform,
    primaryPid: null,
    result: "failed",
    stage: "fixture",
    unexpectedFixtureRequests: 0,
    windowManagerPid: null,
  };
  const server = createServer((request, response) => {
    report.fixtureRequests += 1;
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      pathname === "/api/desktop/session" ||
      pathname === "/api/auth/get-session"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("null");
    } else {
      report.unexpectedFixtureRequests += 1;
      response.writeHead(404);
      response.end();
    }
  });
  let installed:
    | {
        owner: ReturnType<typeof createNativeInstallation>;
        run: RunNativeInstallOperation;
      }
    | undefined;
  let collisionProbes: NativeInstallOperation[] = [];
  let application: ElectronApplication | undefined;
  let keyring: ChildProcess | undefined;
  let windowManager: ChildProcess | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    report.fixturePort = address.port;
    const inheritedNames = new Set([
      "APPDATA",
      "COMSPEC",
      "DBUS_SESSION_BUS_ADDRESS",
      "DISPLAY",
      "HOME",
      "LANG",
      "LC_ALL",
      "LOCALAPPDATA",
      "PATH",
      "PATHEXT",
      "SHELL",
      "SYSTEMROOT",
      "TEMP",
      "TMP",
      "TMPDIR",
      "USERPROFILE",
      "WINDIR",
      "XAUTHORITY",
    ]);
    // oxlint-disable-next-line node/no-process-env -- This test bootstrap forwards only operating-system/session bindings to its owned candidate.
    const inherited = process.env;
    const environment = Object.fromEntries(
      Object.entries(inherited).filter(
        (entry): entry is [string, string] =>
          inheritedNames.has(entry[0].toUpperCase()) && entry[1] !== undefined
      )
    );
    Object.assign(environment, {
      DESKTOP_MAIL_UPDATES_URL: `ws://127.0.0.1:${address.port}/mail/live`,
      DESKTOP_SERVER_URL: `http://127.0.0.1:${address.port}`,
      XDG_CONFIG_HOME: path.join(profile, "config"),
      XDG_CURRENT_DESKTOP: "GNOME",
      XDG_DATA_HOME: path.join(profile, "data"),
      XDG_RUNTIME_DIR: path.join(profile, "runtime"),
    });
    let executable: string;
    if (selection.kind === "install") {
      const run: RunNativeInstallOperation = async (operation) => {
        const previousStage = report.stage;
        report.stage = `native-installation-${operation.kind}`;
        const child = spawn(operation.command, operation.args, {
          detached: process.platform !== "win32",
          env: environment,
          stdio: "ignore",
          windowsVerbatimArguments: operation.verbatim === true,
        });
        let failure: Error | undefined;
        child.on("error", (error) => {
          failure = error;
        });
        try {
          await waitUntil(() => {
            if (failure !== undefined) {
              throw failure;
            }
            return child.exitCode !== null || child.signalCode !== null;
          }, 120_000);
          assert.equal(child.exitCode, operation.expectedExitCode ?? 0);
        } finally {
          const stopped = await stopChild(child);
          report.installationProcesses.push({
            exitCode: child.exitCode,
            kind: operation.kind,
            pid: child.pid ?? null,
            stopped,
          });
          if (!stopped) {
            child.unref();
          }
          assert.ok(stopped, "Owned installation process did not stop.");
        }
        report.stage = previousStage;
      };
      const owner = createNativeInstallation({ environment });
      installed = { owner, run };
      ({
        collisionProbes,
        executable,
        metadata: report.installation,
      } = await owner.prepare(run));
    } else {
      ({ executable } = selection);
    }
    await access(executable);
    const args = [`--user-data-dir=${path.join(profile, "user-data")}`];
    if (process.platform === "linux") {
      report.stage = "window-manager";
      windowManager = spawn("openbox", ["--sm-disable"], {
        detached: true,
        env: environment,
        stdio: "ignore",
      });
      let windowManagerError: Error | undefined;
      windowManager.on("error", (error) => {
        windowManagerError = error;
      });
      report.windowManagerPid = windowManager.pid ?? null;
      await waitUntil(() => {
        if (windowManagerError !== undefined) {
          throw windowManagerError;
        }
        assert.ok(
          windowManager?.exitCode === null,
          "Owned window manager exited."
        );
        return /window id # 0x[\da-f]+/iu.test(
          execFileSync("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], {
            encoding: "utf-8",
            env: environment,
          })
        );
      });
      report.stage = "secure-storage";
      keyring = spawn(
        "gnome-keyring-daemon",
        ["--foreground", "--unlock", "--components=secrets"],
        {
          detached: true,
          env: environment,
          stdio: ["pipe", "ignore", "ignore"],
        }
      );
      let keyringError: Error | undefined;
      keyring.on("error", (error) => {
        keyringError = error;
      });
      keyring.stdin?.on("error", (error) => {
        keyringError = error;
      });
      keyring.stdin?.end(randomBytes(32).toString("base64"));
      report.keyringPid = keyring.pid ?? null;
      await waitUntil(() => {
        if (keyringError !== undefined) {
          throw keyringError;
        }
        assert.ok(keyring?.exitCode === null, "Owned secure storage exited.");
        return execFileSync(
          "gdbus",
          [
            "call",
            "--session",
            "--dest",
            "org.freedesktop.DBus",
            "--object-path",
            "/org/freedesktop/DBus",
            "--method",
            "org.freedesktop.DBus.NameHasOwner",
            "org.freedesktop.secrets",
          ],
          { encoding: "utf-8", env: environment }
        ).includes("true");
      });
      args.push("--password-store=gnome-libsecret");
    }
    report.stage = "packaged-startup";
    report.cleanup.applicationStopped = false;
    application = await _electron.launch({
      args,
      chromiumSandbox: true,
      env: environment,
      executablePath: executable,
      timeout: 30_000,
    });
    const current = application;
    report.primaryPid = current.process().pid ?? null;
    const page = await current.firstWindow();
    await page.waitForURL((url) => url.pathname === "/auth");
    await page.getByRole("button").first().waitFor();
    const state = await current.evaluate(
      ({ app, BrowserWindow, Menu, safeStorage }) => {
        const [window] = BrowserWindow.getAllWindows();
        if (window === undefined) {
          throw new Error("The candidate did not create its main window.");
        }
        return {
          associatedProcesses: app.getAppMetrics().length,
          electronVersion: process.versions.electron,
          mailHandlerMenu:
            Menu.getApplicationMenu()?.getMenuItemById("default-mail-handler")
              ?.enabled === true,
          noSandbox: app.commandLine.hasSwitch("no-sandbox"),
          packaged: app.isPackaged,
          storageAvailable: safeStorage.isEncryptionAvailable(),
          storageBackend:
            process.platform === "linux"
              ? safeStorage.getSelectedStorageBackend()
              : process.platform,
          userData: app.getPath("userData"),
        };
      }
    );
    assert.ok(
      state.packaged && state.storageAvailable && state.mailHandlerMenu
    );
    assert.equal(state.noSandbox, false);
    assert.ok(
      await page.evaluate(
        () =>
          Reflect.get(window, "require") === undefined &&
          Reflect.get(window, "process") === undefined
      )
    );
    assert.notEqual(state.storageBackend, "basic_text");
    const relativeUserData = path.relative(
      await realpath(profile),
      await realpath(state.userData)
    );
    assert.ok(
      !path.isAbsolute(relativeUserData) &&
        relativeUserData !== ".." &&
        !relativeUserData.startsWith(`..${path.sep}`),
      "The candidate profile escaped its owned directory."
    );
    report.electronVersion = state.electronVersion;
    report.storageBackend = state.storageBackend;
    report.associatedProcesses = state.associatedProcesses;
    report.cases.push(
      "packaged-startup",
      "secure-storage",
      "renderer-native-boundary",
      "native-menu"
    );
    if (installed) {
      for (const operation of collisionProbes) {
        await installed.run(operation);
        assert.ok(current.process().exitCode === null);
        assert.equal(current.process().pid, report.primaryPid);
        await access(executable);
        report.cases.push(operation.kind);
      }
    }
    const handoffs = await current.evaluateHandle(({ app }) => {
      const received: string[][] = [];
      app.on("second-instance", (_event, commandLine) => {
        received.push(commandLine);
      });
      return received;
    });
    const handoff = async (input: string): Promise<void> => {
      const before = await handoffs.evaluate((received) => received.length);
      const child = spawn(executable, [...args, input], {
        detached: process.platform !== "win32",
        env: environment,
        stdio: "ignore",
      });
      let secondaryError: Error | undefined;
      child.on("error", (error) => {
        secondaryError = error;
      });
      try {
        await waitUntil(async () => {
          if (secondaryError !== undefined) {
            throw secondaryError;
          }
          return await handoffs.evaluate(
            (received, expected) =>
              received
                .slice(expected.before)
                .some((commandLine) => commandLine.includes(expected.input)),
            { before, input }
          );
        });
        await waitUntil(
          () => child.exitCode !== null || child.signalCode !== null
        );
        assert.equal(
          child.exitCode,
          0,
          "Secondary instance did not exit cleanly."
        );
      } finally {
        assert.ok(
          await stopChild(child),
          "Owned secondary candidate did not stop."
        );
      }
      assert.ok(
        current.process().exitCode === null &&
          current.process().pid === report.primaryPid
      );
    };
    report.stage = "single-instance-restoration";
    await current.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    await waitUntil(
      async () =>
        await current.evaluate(({ BrowserWindow }) => {
          const [window] = BrowserWindow.getAllWindows();
          return window !== undefined && window.isMinimized();
        })
    );
    await handoff("mailto:native-smoke@example.test?subject=Native%20smoke");
    await waitUntil(
      async () =>
        await current.evaluate(({ BrowserWindow }) => {
          const [window] = BrowserWindow.getAllWindows();
          return (
            BrowserWindow.getAllWindows().length === 1 &&
            window !== undefined &&
            window.isVisible() &&
            !window.isMinimized()
          );
        })
    );
    report.cases.push("native-second-process-restoration");
    report.stage = "signed-out-pending-link-denial";
    assert.ok(
      await page.evaluate(
        async () =>
          (await window.quieterDesktop.nativeLinks.read({
            kind: "peek",
            userId: "native-smoke-user",
          })) === null
      )
    );
    report.cases.push("signed-out-pending-link-denial");
    const previousURL = page.url();
    await handoff("https://example.invalid/native-smoke");
    assert.ok(
      page.url() === previousURL,
      "A foreign URL replaced the app renderer."
    );
    report.cases.push("foreign-command-url-ignored");
    await page.screenshot({ path: path.join(output, "signed-out.png") });
    if (process.platform === "darwin") {
      report.stage = "closed-window-restoration";
      const nextWindow = (async () => {
        try {
          return { reopened: await current.waitForEvent("window") };
        } catch (error) {
          return { error };
        }
      })();
      await current.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      });
      await handoff("mailto:native-smoke@example.test");
      const next = await nextWindow;
      if ("error" in next) {
        throw next.error;
      }
      await next.reopened.waitForURL((url) => url.pathname === "/auth");
      await next.reopened.getByRole("button").first().waitFor();
      report.cases.push("macos-closed-window-restoration");
    }
    assert.equal(
      report.unexpectedFixtureRequests,
      0,
      "The fixture received an unsupported request."
    );
    assert.ok(report.fixtureRequests > 0);
    report.result = "passed";
    report.stage = "complete";
  } catch (error) {
    report.failureName = error instanceof Error ? error.name : "UnknownError";
    process.exitCode = 1;
  } finally {
    if (application) {
      const current = application;
      const process = current.process();
      const closing = (async () => {
        try {
          await current.close();
          return true;
        } catch {
          return false;
        }
      })();
      report.cleanup.applicationExit = (await Promise.race([
        closing,
        delay(5000, false, { ref: false }),
      ]))
        ? "graceful"
        : "forced";
      report.cleanup.applicationStopped = await stopChild(process);
    }
    if (keyring) {
      report.cleanup.keyringStopped = await stopChild(keyring);
    }
    if (windowManager) {
      report.cleanup.windowManagerStopped = await stopChild(windowManager);
    }
    if (installed) {
      report.installationCleanup = await installed.owner.cleanup(
        installed.run,
        report.cleanup.applicationStopped &&
          report.installationProcesses.every((entry) => entry.stopped)
      );
    }
    server.closeAllConnections();
    if (server.listening) {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
    await rm(profile, { force: true, recursive: true });
    if (
      !(
        report.cleanup.applicationStopped &&
        report.cleanup.keyringStopped &&
        report.cleanup.windowManagerStopped
      ) ||
      report.cleanup.applicationExit === "forced" ||
      report.installationCleanup?.result === "retained"
    ) {
      report.result = "failed";
      process.exitCode = 1;
    }
    await writeFile(
      path.join(output, "native-smoke.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    process.stdout.write(
      `Native candidate smoke ${report.result}, stage ${report.stage}.\n`
    );
  }
};

await main();
