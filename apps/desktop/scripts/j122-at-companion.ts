import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { z } from "zod";

type Result =
  | "setup-failure"
  | "native-failure"
  | "app-absence"
  | "at-content-absence"
  | "speech-absence"
  | "audio-absence"
  | "observation-window-insufficient"
  | "cleanup-failure"
  | "observed-pipeline-pass";

type ProcessRecord = {
  pid: number;
  parentPid: number;
  group: number;
  startTicks: string;
  executable: string;
  command: string;
  owner: string;
  at: number;
};

type Owned = {
  name: string;
  command: string;
  args: string[];
  child: ChildProcess;
  pid: number;
  stdout: string;
  stderr: string;
  captured: { stdout: string; stderr: string };
  closed: Promise<void>;
  error: string | null;
  forced: boolean;
  stopped: boolean;
};

type AudioBlock = {
  at: number;
  firstFrame: number;
  frames: number;
  nonzero: number;
  peak: number;
  rms: number;
};

const nativeSchema = z.object({
  checkoutRevision: z.string(),
  cleanup: z.object({
    applicationExit: z.enum(["not-started", "graceful", "forced"]),
    applicationStopped: z.boolean(),
    keyringStopped: z.boolean(),
    windowManagerStopped: z.boolean(),
  }),
  primaryPid: z.number().int().positive().nullable(),
  result: z.enum(["passed", "failed"]),
  stage: z.string(),
});

const observerProcessSchema = z.object({
  ancestors: z.array(
    z.object({ parentPid: z.number(), pid: z.number(), startTicks: z.string() })
  ),
});

const observerSchema = z.object({
  appPid: z.number().optional(),
  appProcess: observerProcessSchema.optional(),
  at: z.number(),
  candidateExecutable: z.boolean().optional(),
  event: z.string().optional(),
  kind: z.string(),
  name: z.string().optional(),
  nodes: z
    .array(
      z.object({
        inDocument: z.boolean(),
        name: z.string(),
        role: z.string(),
        text: z.string(),
      })
    )
    .optional(),
  role: z.string().optional(),
  sourcePid: z.number().optional(),
  sourceProcess: observerProcessSchema.optional(),
});

const hashFile = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    assert.ok(Buffer.isBuffer(chunk));
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const processInfo = async (
  pid: number
): Promise<Omit<ProcessRecord, "owner" | "at"> | null> => {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf-8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    const parentPid = Number(fields[1]);
    const group = Number(fields[2]);
    const { 19: startTicks } = fields;
    assert.ok(startTicks && Number.isInteger(parentPid) && group > 0);
    const commandLine = await readFile(`/proc/${pid}/cmdline`, "utf-8");
    return {
      command: commandLine.replaceAll("\0", " ").slice(0, 1024),
      executable: await readlink(`/proc/${pid}/exe`),
      group,
      parentPid,
      pid,
      startTicks,
    };
  } catch {
    return null;
  }
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      executable: { type: "string" },
      help: { type: "boolean" },
      output: { type: "string" },
      revision: { type: "string" },
    },
  });
  if (values.help === true) {
    process.stdout.write(
      "Usage: vp exec node apps/desktop/scripts/j122-at-companion.ts --revision <companion-SHA> --output <absolute-evidence-root> --executable /opt/quieter/quieter\n"
    );
    return;
  }
  assert.ok(values.output && path.isAbsolute(values.output));
  assert.ok(values.revision && /^[a-f0-9]{40}$/u.test(values.revision));
  assert.equal(values.executable, "/opt/quieter/quieter");
  const { output } = values;
  const { revision } = values;
  await mkdir(output, { mode: 0o700, recursive: true });
  const outputStat = await lstat(output);
  assert.ok(outputStat.isDirectory() && outputStat.uid === process.getuid?.());
  await chmod(output, 0o700);
  const reportPath = path.join(output, "at-companion.json");
  const reportHandle = await open(reportPath, "wx", 0o600);
  await reportHandle.close();
  const nativeOutput = path.join(output, "native");
  const nativeReportPath = path.join(nativeOutput, "native-smoke.json");
  const observerPath = path.join(import.meta.dirname, "j122-at-observer.py");
  const observerOutput = path.join(output, "atspi.ndjson");
  const orcaLog = path.join(output, "orca-debug.log");
  const speechOutput = path.join(output, "orca-appended.ndjson");
  const audioOutput = path.join(output, "speech.wav");
  const processes: Owned[] = [];
  const tracked = new Map<number, ProcessRecord>();
  const audioBlocks: AudioBlock[] = [];
  const speechLines: { at: number; line: string }[] = [];
  const espeakSamples: { at: number; pids: number[] }[] = [];
  const candidateSamples: { at: number; pids: number[] }[] = [];
  const report = {
    audio: {
      bitsPerSample: 16,
      blocks: audioBlocks,
      bytes: 0,
      channels: 1,
      dataOffset: 0,
      durationSeconds: 0,
      file: audioOutput,
      finalized: false,
      frames: 0,
      nonzero: 0,
      peak: 0,
      rms: 0,
      sampleRate: 16_000,
    },
    candidateSamples,
    capture: {
      applicationObservedMs: 0,
      nativeEnd: 0,
      nativeStart: 0,
      readyAt: 0,
      recorderStart: 0,
      silenceFrames: 0,
    },
    cgroup: {} as Record<string, string>,
    checkoutRevision: revision,
    cleanup: { native: false, owned: false, temporaryDirectoryRemoved: false },
    commands: [] as {
      name: string;
      command: string;
      args: string[];
      pid: number;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      signal: string | null;
      forced: boolean;
      stopped: boolean;
      error: string | null;
    }[],
    correlation: [] as {
      appPid: number;
      content: string;
      eventAt: number;
      speechAt: number;
      audioAt: number;
      modulePids: number[];
    }[],
    error: null as string | null,
    espeakSamples,
    finishedAt: 0,
    hashes: {} as Record<string, string>,
    helperMode: "unmodified-native-cli-existing-executable",
    kind: "j122-passive-at-companion",
    limitations: [
      "Passive capability observation, no UI input and no second application lifecycle.",
      "Audio timing uses observed file appends, not transcription or exact utterance timing.",
      "A pipeline pass does not establish final J122 form or interactive screen reader coverage.",
    ],
    memory: [] as { at: number; availableMiB: number }[],
    nativeReportPath,
    os: "",
    outcomeBeforeCleanup: null as Result | null,
    ownedProcesses: [] as ProcessRecord[],
    result: "setup-failure" as Result,
    stage: "preflight",
    startedAt: Date.now(),
    temporaryDirectory: "",
    versions: {} as Record<string, string>,
  };
  let temporary = "";
  const failure: { message: string | null } = { message: null };
  let mustStopNative = false;
  const monitoring = { active: false, capture: true };
  let monitor: Promise<void> | null = null;
  let orcaOffset = 0;
  let orcaPartial = "";
  let audioOffset = 0;
  let lastSpeechAt = Date.now();
  let silenceFrames = 0;
  let moduleExecutable = "";
  let candidateExecutable = "";
  let native: Owned | null = null;
  // oxlint-disable-next-line node/no-process-env -- The companion bootstrap forwards only OS/session bindings and creates private AT configuration.
  const inherited = process.env;
  const allowed = new Set([
    "PATH",
    "LANG",
    "LC_ALL",
    "CI",
    "DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
  ]);
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      (entry): entry is [string, string] =>
        allowed.has(entry[0]) && entry[1] !== undefined
    )
  );
  environment.HOME = homedir();
  const interrupted = (signal: NodeJS.Signals): void => {
    failure.message ??= `Interrupted by ${signal}.`;
    mustStopNative = true;
  };
  process.on("SIGTERM", interrupted);
  process.on("SIGINT", interrupted);

  const save = async (): Promise<void> => {
    report.ownedProcesses = [...tracked.values()];
    report.commands = processes.map((owned) => ({
      args: owned.args,
      command: owned.command,
      error: owned.error,
      exitCode: owned.child.exitCode,
      forced: owned.forced,
      name: owned.name,
      pid: owned.pid,
      signal: owned.child.signalCode,
      stderr: owned.stderr,
      stdout: owned.stdout,
      stopped: owned.stopped,
    }));
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  };

  const start = async (
    name: string,
    command: string,
    args: string[]
  ): Promise<Owned> => {
    const stdout = path.join(output, `${name}.stdout.log`);
    const stderr = path.join(output, `${name}.stderr.log`);
    await writeFile(stdout, "", { flag: "wx", mode: 0o600 });
    await writeFile(stderr, "", { flag: "wx", mode: 0o600 });
    const child = spawn(command, args, {
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const owned: Owned = {
      args,
      captured: { stderr: "", stdout: "" },
      child,
      closed: Promise.resolve(),
      command,
      error: null,
      forced: false,
      name,
      pid: child.pid ?? 0,
      stderr,
      stdout,
      stopped: false,
    };
    processes.push(owned);
    const writes: Promise<void>[] = [];
    const closed = Promise.withResolvers<null>();
    child.once("close", () => {
      closed.resolve(null);
    });
    child.on("error", (error) => {
      owned.error = error.message;
    });
    owned.closed = (async () => {
      await closed.promise;
      await Promise.all(writes);
      owned.stopped = true;
    })();
    for (const channel of ["stdout", "stderr"] as const) {
      // oxlint-disable-next-line no-loop-func -- Each stream closes over its own const channel and the shared task failure state.
      child[channel]?.on("data", (chunk: Buffer) => {
        const remaining =
          256 * 1024 - Buffer.byteLength(owned.captured[channel]);
        if (chunk.length > remaining) {
          failure.message ??= `${name} ${channel} exceeded the evidence limit.`;
        }
        const text = chunk
          .subarray(0, Math.max(remaining, 0))
          .toString("utf-8");
        owned.captured[channel] += text;
        writes.push(
          (async () => {
            try {
              await appendFile(owned[channel], text);
            } catch (error) {
              failure.message ??= String(error);
            }
          })()
        );
      });
    }
    if (owned.pid > 0) {
      const info = await processInfo(owned.pid);
      if (info) {
        tracked.set(info.pid, { ...info, at: Date.now(), owner: name });
      }
    }
    if (owned.pid > 0 && !tracked.has(owned.pid)) {
      await Promise.race([owned.closed, delay(250)]);
    }
    if (
      owned.pid > 0 &&
      !tracked.has(owned.pid) &&
      !owned.stopped &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      owned.error ??= "The live owned process identity could not be recorded.";
      failure.message ??= owned.error;
    }
    await save();
    return owned;
  };

  const stop = async (
    owned: Owned,
    signal: "SIGINT" | "SIGTERM" = "SIGTERM"
  ): Promise<void> => {
    const groups = new Set<number>();
    for (const record of tracked.values()) {
      if (record.owner !== owned.name) {
        continue;
      }
      const current = await processInfo(record.pid);
      if (current?.startTicks === record.startTicks) {
        groups.add(current.group);
      }
    }
    for (const group of groups) {
      try {
        process.kill(-group, signal);
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ESRCH")
        ) {
          owned.error ??= String(error);
        }
      }
    }
    if (owned.name === "native" && owned.stopped && groups.size > 0) {
      owned.error ??= "The native helper left recorded descendants running.";
    }
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      let alive = false;
      for (const record of tracked.values()) {
        if (record.owner !== owned.name) {
          continue;
        }
        const current = await processInfo(record.pid);
        alive ||= current?.startTicks === record.startTicks;
      }
      if (!alive) {
        await Promise.race([owned.closed, delay(1000)]);
        if (!owned.stopped) {
          owned.error ??= "Owned process exit was not confirmed.";
        }
        return;
      }
      await delay(50);
    }
    owned.forced = true;
    for (const record of tracked.values()) {
      if (record.owner !== owned.name) {
        continue;
      }
      const current = await processInfo(record.pid);
      if (current?.startTicks === record.startTicks) {
        try {
          process.kill(-current.group, "SIGKILL");
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ESRCH"
            )
          ) {
            owned.error ??= String(error);
          }
        }
      }
    }
    await Promise.race([owned.closed, delay(1000)]);
  };

  const waitFor = async (
    check: () => boolean | Promise<boolean>,
    timeout: number,
    preserveNativeLifecycle = false
  ): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (failure.message && (!preserveNativeLifecycle || mustStopNative)) {
        throw new Error(failure.message);
      }
      if (await check()) {
        return;
      }
      await delay(100);
    }
    throw new Error(`Timed out in ${report.stage}.`);
  };

  const command = async (
    name: string,
    binary: string,
    args: string[]
  ): Promise<string> => {
    const owned = await start(name, binary, args);
    try {
      await waitFor(() => owned.stopped, 5000);
      assert.equal(
        owned.child.exitCode,
        0,
        owned.captured.stderr || owned.error || `${name} failed.`
      );
      return owned.captured.stdout.trim();
    } finally {
      if (!owned.stopped) {
        await stop(owned);
      }
    }
  };

  const memory = async (): Promise<void> => {
    const meminfo = await readFile("/proc/meminfo", "utf-8");
    const available = /^MemAvailable:\s+(?<available>\d+) kB$/mu.exec(meminfo)
      ?.groups?.available;
    assert.ok(available, "MemAvailable is unavailable.");
    const availableMiB = Number(available) / 1024;
    report.memory.push({ at: Date.now(), availableMiB });
    if (availableMiB < 3072) {
      mustStopNative = true;
      throw new Error("MemAvailable fell below 3072 MiB.");
    }
  };

  const sampleEvidence = async (): Promise<void> => {
    const entries = await readdir("/proc");
    const infos = await Promise.all(
      entries
        .filter((entry) => /^\d+$/u.test(entry))
        .map(async (entry) => await processInfo(Number(entry)))
    );
    const currentProcesses = new Map(
      infos.flatMap((info) =>
        info === null ? [] : [[info.pid, info] as const]
      )
    );
    for (let pass = 0; pass < 24; pass += 1) {
      let changed = false;
      for (const info of infos) {
        if (!info || tracked.has(info.pid)) {
          continue;
        }
        const parent = tracked.get(info.parentPid);
        if (
          parent &&
          currentProcesses.get(parent.pid)?.startTicks === parent.startTicks
        ) {
          tracked.set(info.pid, {
            ...info,
            at: Date.now(),
            owner: parent.owner,
          });
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
    assert.ok(
      tracked.size <= 2048,
      "Owned process evidence exceeded its limit."
    );
    espeakSamples.push({
      at: Date.now(),
      pids: infos
        .filter(
          (info) =>
            info !== null &&
            info.executable === moduleExecutable &&
            tracked.get(info.pid)?.owner === "dispatcher"
        )
        .map((info) => info?.pid ?? 0),
    });
    candidateSamples.push({
      at: Date.now(),
      pids: infos.flatMap((info) =>
        info !== null &&
        info.executable === candidateExecutable &&
        tracked.get(info.pid)?.owner === "native"
          ? [info.pid]
          : []
      ),
    });
    const dispatcherLogs = await readdir(path.join(output, "dispatcher-logs"));
    let dispatcherBytes = 0;
    for (const name of dispatcherLogs) {
      const info = await stat(path.join(output, "dispatcher-logs", name));
      dispatcherBytes += info.size;
    }
    assert.ok(
      dispatcherBytes <= 4 * 1024 * 1024,
      "Dispatcher logs exceeded their evidence limit."
    );
    try {
      const file = await open(orcaLog, "r");
      try {
        const { size } = await file.stat();
        assert.ok(
          size <= 4 * 1024 * 1024,
          "Orca debug evidence exceeded its limit."
        );
        if (size > orcaOffset) {
          const bytes = Buffer.alloc(size - orcaOffset);
          await file.read(bytes, 0, bytes.length, orcaOffset);
          orcaOffset = size;
          const lines = `${orcaPartial}${bytes.toString("utf-8")}`.split("\n");
          orcaPartial = lines.pop() ?? "";
          const at = Date.now();
          const appended = lines.map((line) => ({ at, line }));
          speechLines.push(
            ...appended.filter((line) => line.line.includes("SPEECH OUTPUT"))
          );
          if (appended.some((line) => line.line.includes("SPEECH OUTPUT"))) {
            lastSpeechAt = at;
          }
          if (lines.length > 0) {
            await appendFile(
              speechOutput,
              `${appended.map((line) => JSON.stringify(line)).join("\n")}\n`
            );
          }
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    try {
      const file = await open(audioOutput, "r");
      try {
        const { size } = await file.stat();
        assert.ok(
          size <= 6 * 1024 * 1024,
          "Audio evidence exceeded its limit."
        );
        if (audioOffset === 0 && size >= 44) {
          const header = Buffer.alloc(Math.min(size, 4096));
          await file.read(header, 0, header.length, 0);
          assert.equal(header.toString("ascii", 0, 4), "RIFF");
          assert.equal(header.toString("ascii", 8, 12), "WAVE");
          let offset = 12;
          let format = false;
          while (offset + 8 <= header.length) {
            const kind = header.toString("ascii", offset, offset + 4);
            const length = header.readUInt32LE(offset + 4);
            if (kind === "fmt " && offset + 24 <= header.length) {
              assert.equal(header.readUInt16LE(offset + 8), 1);
              assert.equal(header.readUInt16LE(offset + 10), 1);
              assert.equal(header.readUInt32LE(offset + 12), 16_000);
              assert.equal(header.readUInt16LE(offset + 22), 16);
              format = true;
            }
            if (kind === "data") {
              assert.ok(format);
              audioOffset = offset + 8;
              report.audio.dataOffset = audioOffset;
              break;
            }
            offset += 8 + length + (length % 2);
          }
        }
        const length = size - audioOffset - ((size - audioOffset) % 2);
        if (audioOffset > 0 && length > 0) {
          const bytes = Buffer.alloc(length);
          await file.read(bytes, 0, length, audioOffset);
          let nonzero = 0;
          let peak = 0;
          let squares = 0;
          for (let offset = 0; offset < length; offset += 2) {
            const value = bytes.readInt16LE(offset);
            if (value !== 0) {
              nonzero += 1;
            }
            peak = Math.max(peak, Math.abs(value));
            squares += value * value;
          }
          const frames = length / 2;
          audioBlocks.push({
            at: Date.now(),
            firstFrame: report.audio.frames,
            frames,
            nonzero,
            peak,
            rms: Math.sqrt(squares / frames),
          });
          report.audio.frames += frames;
          audioOffset += length;
          silenceFrames = nonzero === 0 ? silenceFrames + frames : 0;
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    for (const owned of processes) {
      if (
        ["pulse", "recorder", "dispatcher", "orca", "observer"].includes(
          owned.name
        ) &&
        owned.stopped
      ) {
        throw new Error(`${owned.name} exited during observation.`);
      }
    }
  };

  try {
    assert.equal(process.platform, "linux");
    assert.notEqual(
      process.getuid?.(),
      0,
      "The companion must run as the ordinary runner user."
    );
    assert.ok(
      environment.DISPLAY && environment.DBUS_SESSION_BUS_ADDRESS,
      "A private Xvfb and D-Bus session is required."
    );
    report.os = await readFile("/etc/os-release", "utf-8");
    assert.match(report.os, /^ID=ubuntu$/mu);
    assert.match(report.os, /^VERSION_ID="24\.04"$/mu);
    await memory();
    const cgroupMembership = await readFile("/proc/self/cgroup", "utf-8");
    const cgroup = cgroupMembership
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3);
    assert.ok(
      cgroup && cgroup !== "/",
      "A bounded transient cgroup is required."
    );
    report.cgroup.path = cgroup;
    for (const name of [
      "memory.max",
      "memory.swap.max",
      "cpu.max",
      "pids.max",
      "memory.events",
    ]) {
      const setting = await readFile(
        path.join("/sys/fs/cgroup", cgroup, name),
        "utf-8"
      );
      report.cgroup[name] = setting.trim();
    }
    assert.equal(report.cgroup["memory.max"], String(2 * 1024 ** 3));
    assert.equal(report.cgroup["memory.swap.max"], "0");
    assert.equal(report.cgroup["pids.max"], "256");
    assert.equal(report.cgroup["cpu.max"], "100000 100000");
    const head = await command("checkout-revision", "git", [
      "rev-parse",
      "HEAD",
    ]);
    assert.equal(
      head,
      revision,
      "--revision must identify the current companion checkout."
    );
    const candidate = await realpath(values.executable);
    candidateExecutable = candidate;
    report.hashes[candidate] = await hashFile(candidate);
    report.hashes[process.execPath] = await hashFile(process.execPath);
    report.versions.node = process.version;
    for (const script of [
      import.meta.filename,
      observerPath,
      path.join(import.meta.dirname, "native-smoke.ts"),
      path.join(import.meta.dirname, "native-install.ts"),
    ]) {
      report.hashes[script] = await hashFile(script);
    }
    temporary = await mkdtemp(path.join(tmpdir(), "j122-at-"));
    await chmod(temporary, 0o700);
    report.temporaryDirectory = temporary;
    for (const name of [
      "config",
      "data",
      "cache",
      "runtime",
      "orca",
      "dispatcher",
      "pulse",
    ]) {
      await mkdir(path.join(temporary, name), { mode: 0o700 });
    }
    Object.assign(environment, {
      NO_AT_BRIDGE: "0",
      PULSE_SERVER: `unix:${temporary}/pulse/native`,
      SPEECHD_ADDRESS: `unix_socket:${temporary}/runtime/speechd.sock`,
      XDG_CACHE_HOME: path.join(temporary, "cache"),
      XDG_CONFIG_HOME: path.join(temporary, "config"),
      XDG_DATA_HOME: path.join(temporary, "data"),
      XDG_RUNTIME_DIR: path.join(temporary, "runtime"),
    });
    const binaries = [
      "pulseaudio",
      "pactl",
      "parecord",
      "speech-dispatcher",
      "orca",
      "gdbus",
      "espeak-ng",
    ];
    for (const binary of binaries) {
      const located = await command(`locate-${binary}`, "/usr/bin/which", [
        binary,
      ]);
      report.hashes[located] = await hashFile(await realpath(located));
      report.versions[binary] = await command(`version-${binary}`, binary, [
        binary === "gdbus" ? "help" : "--version",
      ]);
    }
    report.hashes["/usr/bin/python3"] = await hashFile(
      await realpath("/usr/bin/python3")
    );
    report.versions.python3 = await command(
      "version-python3",
      "/usr/bin/python3",
      ["--version"]
    );
    const orcaHelp = await command("orca-help", "orca", ["--help"]);
    for (const option of [
      "--user-prefs",
      "--speech-system",
      "--enable",
      "--disable",
      "--debug-file",
    ]) {
      assert.ok(orcaHelp.includes(option), `Installed Orca lacks ${option}.`);
    }
    assert.match(report.versions.orca ?? "", /\b46\./u);
    await command("dispatcher-help", "speech-dispatcher", ["--help"]);
    const packageFiles = await command("espeak-package-files", "dpkg-query", [
      "-L",
      "speech-dispatcher-espeak-ng",
    ]);
    const moduleFiles = packageFiles.split("\n");
    const modulePath = moduleFiles.find((file) =>
      file.endsWith("/sd_espeak-ng")
    );
    const moduleConfig = moduleFiles.find((file) =>
      file.endsWith("/modules/espeak-ng.conf")
    );
    assert.ok(
      modulePath && moduleConfig,
      "The packaged espeak-ng module and configuration are required."
    );
    moduleExecutable = await realpath(modulePath);
    await access(moduleExecutable);
    report.hashes[moduleExecutable] = await hashFile(moduleExecutable);
    report.hashes[moduleConfig] = await hashFile(moduleConfig);
    await copyFile(moduleConfig, path.join(output, "installed-espeak-ng.conf"));
    await copyFile(
      "/etc/speech-dispatcher/speechd.conf",
      path.join(output, "installed-speechd.conf")
    );
    const pulseConfig = path.join(temporary, "pulse", "private.pa");
    const pulseText = `load-module module-native-protocol-unix socket=${temporary}/pulse/native auth-anonymous=1\nload-module module-null-sink sink_name=j122 rate=16000 channels=1 channel_map=mono\nset-default-sink j122\nset-default-source j122.monitor\n`;
    await writeFile(pulseConfig, pulseText, { mode: 0o600 });
    await writeFile(path.join(output, "private.pa"), pulseText, {
      mode: 0o600,
    });
    const dispatcherText = `CommunicationMethod unix_socket\nSocketPath "${temporary}/runtime/speechd.sock"\nLogLevel 4\nDefaultLanguage "en-US"\nDefaultModule espeak-ng\nAudioOutputMethod pulse\nAudioPulseDevice "j122"\nAddModule "espeak-ng" "${moduleExecutable}" "${moduleConfig}"\nDisableAutoSpawn\n`;
    await writeFile(
      path.join(temporary, "dispatcher", "speechd.conf"),
      dispatcherText,
      { mode: 0o600 }
    );
    await writeFile(path.join(output, "speechd.conf"), dispatcherText, {
      mode: 0o600,
    });
    await mkdir(path.join(output, "dispatcher-logs"), { mode: 0o700 });
    const orcaSettings = {
      general: {
        activeProfile: ["Default", "default"],
        enableBraille: false,
        enableMouseReview: false,
        enableSound: false,
        enableSpeech: true,
        firstStart: false,
        speechServerFactory: "speechdispatcherfactory",
        startingProfile: ["Default", "default"],
      },
      keybindings: {},
      profiles: { default: { profile: ["Default", "default"] } },
      pronunciations: {},
    };
    await writeFile(
      path.join(temporary, "orca", "user-settings.conf"),
      `${JSON.stringify(orcaSettings)}\n`,
      { mode: 0o600 }
    );
    await writeFile(speechOutput, "", { flag: "wx", mode: 0o600 });
    await memory();
    monitoring.active = true;
    monitor = (async () => {
      while (monitoring.active) {
        try {
          await memory();
        } catch (error) {
          mustStopNative = true;
          failure.message ??= String(error);
        }
        if (monitoring.capture) {
          try {
            await sampleEvidence();
          } catch (error) {
            failure.message ??= String(error);
          }
        }
        if (failure.message && monitoring.capture) {
          monitoring.capture = false;
          report.error ??= failure.message;
          if (!mustStopNative) {
            for (const owned of processes) {
              if (
                [
                  "recorder",
                  "orca",
                  "observer",
                  "dispatcher",
                  "pulse",
                ].includes(owned.name)
              ) {
                await stop(
                  owned,
                  owned.name === "recorder" ? "SIGINT" : "SIGTERM"
                );
              }
            }
          }
        }
        await delay(100);
      }
    })();
    report.stage = "private-audio";
    await start("pulse", "pulseaudio", [
      "-n",
      "--daemonize=no",
      "--use-pid-file=no",
      "--exit-idle-time=-1",
      "-F",
      pulseConfig,
    ]);
    await waitFor(async () => {
      try {
        const socket = await stat(path.join(temporary, "pulse", "native"));
        return socket.isSocket();
      } catch {
        return false;
      }
    }, 5000);
    const sinks = await command("private-sinks", "pactl", [
      "--format=json",
      "list",
      "sinks",
    ]);
    const sinkSchema = z.array(
      z.object({ name: z.string(), sample_specification: z.string() })
    );
    const parsedSinks = sinkSchema.parse(JSON.parse(sinks));
    assert.ok(
      parsedSinks.length === 1 &&
        parsedSinks[0]?.name === "j122" &&
        parsedSinks[0].sample_specification.includes("16000Hz")
    );
    report.capture.recorderStart = Date.now();
    await start("recorder", "parecord", [
      "--device=j122.monitor",
      "--file-format=wav",
      "--format=s16le",
      "--rate=16000",
      "--channels=1",
      "--latency-msec=50",
      audioOutput,
    ]);
    report.stage = "private-speech-dispatcher";
    await start("dispatcher", "speech-dispatcher", [
      "-s",
      "-t",
      "0",
      "-C",
      path.join(temporary, "dispatcher"),
      "-L",
      path.join(output, "dispatcher-logs"),
      "-S",
      path.join(temporary, "runtime", "speechd.sock"),
      "-P",
      path.join(temporary, "runtime", "speechd.pid"),
    ]);
    await waitFor(async () => {
      try {
        const socket = await stat(
          path.join(temporary, "runtime", "speechd.sock")
        );
        return socket.isSocket();
      } catch {
        return false;
      }
    }, 5000);
    report.stage = "private-accessibility-bus";
    const dbusArgs = [
      "call",
      "--session",
      "--dest",
      "org.a11y.Bus",
      "--object-path",
      "/org/a11y/bus",
    ];
    for (const property of ["IsEnabled", "ScreenReaderEnabled"]) {
      await command(`a11y-set-${property}`, "gdbus", [
        ...dbusArgs,
        "--method",
        "org.freedesktop.DBus.Properties.Set",
        "org.a11y.Status",
        property,
        "<true>",
      ]);
      const enabled = await command(`a11y-read-${property}`, "gdbus", [
        ...dbusArgs,
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.a11y.Status",
        property,
      ]);
      assert.ok(enabled.includes("true"));
    }
    await command("a11y-address", "gdbus", [
      ...dbusArgs,
      "--method",
      "org.a11y.Bus.GetAddress",
    ]);
    report.stage = "prearmed-observers";
    await start("observer", "/usr/bin/python3", [
      observerPath,
      "--output",
      observerOutput,
      "--executable",
      candidate,
    ]);
    await start("orca", "orca", [
      "--user-prefs",
      path.join(temporary, "orca"),
      "--speech-system",
      "speechdispatcherfactory",
      "--enable",
      "speech",
      "--disable",
      "braille",
      "--disable",
      "braille-monitor",
      "--debug-file",
      orcaLog,
    ]);
    await waitFor(async () => {
      try {
        const observer = await readFile(observerOutput, "utf-8");
        const debug = await readFile(orcaLog, "utf-8");
        return (
          observer.includes('"kind": "ready"') &&
          debug.includes("Starting Atspi main event loop") &&
          espeakSamples.some((sample) => sample.pids.length > 0)
        );
      } catch {
        return false;
      }
    }, 10_000);
    report.capture.readyAt = Date.now();
    report.stage = "startup-silence-tail";
    await waitFor(
      () => silenceFrames >= 12_000 && Date.now() - lastSpeechAt >= 750,
      10_000
    );
    report.capture.silenceFrames = silenceFrames;
    report.stage = "native-observation";
    report.capture.nativeStart = Date.now();
    native = await start("native", "vp", [
      "run",
      "@quieter/desktop#test:native",
      "--revision",
      revision,
      "--output",
      nativeOutput,
      "--executable",
      candidate,
    ]);
    await waitFor(() => native?.stopped === true, 120_000, true);
    report.capture.nativeEnd = Date.now();
    const nativeReport = nativeSchema.parse(
      JSON.parse(await readFile(nativeReportPath, "utf-8"))
    );
    assert.equal(nativeReport.checkoutRevision, revision);
    const { cleanup } = nativeReport;
    report.cleanup.native =
      cleanup.applicationStopped &&
      cleanup.keyringStopped &&
      cleanup.windowManagerStopped &&
      cleanup.applicationExit === "graceful";
    if (native.child.exitCode !== 0 || nativeReport.result !== "passed") {
      report.result = "native-failure";
    } else if (failure.message) {
      report.result = "setup-failure";
      report.error = failure.message;
    } else {
      report.stage = "evaluate-observation";
      await delay(250);
      const observerText = await readFile(observerOutput, "utf-8");
      const records = observerText
        .split("\n")
        .filter(Boolean)
        .map((line) => observerSchema.parse(JSON.parse(line)));
      const interval = records.filter(
        (record) =>
          record.at >= report.capture.nativeStart &&
          record.at <= report.capture.nativeEnd
      );
      assert.ok(
        nativeReport.primaryPid !== null,
        "The native report did not identify its primary application."
      );
      const { primaryPid } = nativeReport;
      const primaryIdentity = tracked.get(primaryPid);
      const candidatePids = new Set([primaryPid]);
      for (const record of tracked.values()) {
        if (record.owner !== "native" || record.executable !== candidate) {
          continue;
        }
        let ancestor: ProcessRecord | undefined = record;
        for (let depth = 0; ancestor && depth < 24; depth += 1) {
          if (ancestor.pid === primaryPid) {
            candidatePids.add(record.pid);
            break;
          }
          ancestor = tracked.get(ancestor.parentPid);
        }
      }
      const appRecords = interval.filter(
        (record) =>
          record.candidateExecutable === true &&
          (candidatePids.has(record.appPid ?? 0) ||
            candidatePids.has(record.sourcePid ?? 0) ||
            [record.appProcess, record.sourceProcess].some(
              (identity) =>
                identity?.ancestors.some(
                  (ancestor) =>
                    ancestor.pid === primaryPid &&
                    (primaryIdentity === undefined ||
                      ancestor.startTicks === primaryIdentity.startTicks)
                ) === true
            ))
      );
      const content = appRecords.flatMap((record) =>
        (record.nodes ?? [])
          .flatMap((node) =>
            node.inDocument &&
            /button|text|static|paragraph|heading|entry|link/iu.test(node.role)
              ? [node.name, node.text]
              : []
          )
          .filter(
            (text) =>
              text.trim().length >= 5 && !/^quieter$/iu.test(text.trim())
          )
          .map((text) => ({
            at: record.at,
            pid: record.appPid ?? 0,
            text: text.trim(),
          }))
      );
      const utterances = speechLines.filter(
        (line) =>
          line.at >= report.capture.nativeStart &&
          line.at <= report.capture.nativeEnd &&
          !/screen reader (?:on|off)/iu.test(line.line)
      );
      for (const item of content) {
        if (report.correlation.length >= 16) {
          break;
        }
        const words = item.text.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
        if (words.length < 2) {
          continue;
        }
        for (const utterance of utterances) {
          if (
            Math.abs(utterance.at - item.at) > 2000 ||
            !utterance.line.toLowerCase().includes(words.join(" "))
          ) {
            continue;
          }
          const audio = audioBlocks.find(
            (block) =>
              block.at >= report.capture.nativeStart &&
              block.at <= report.capture.nativeEnd &&
              block.at >= utterance.at - 250 &&
              block.at <= utterance.at + 2500 &&
              block.nonzero >= 80 &&
              block.peak >= 64
          );
          const module = espeakSamples.find(
            (sample) =>
              sample.pids.length > 0 &&
              Math.abs(sample.at - utterance.at) <= 500
          );
          if (audio && module) {
            report.correlation.push({
              appPid: item.pid,
              audioAt: audio.at,
              content: item.text,
              eventAt: item.at,
              modulePids: module.pids,
              speechAt: utterance.at,
            });
            break;
          }
        }
      }
      const primarySamples = candidateSamples.filter((item) =>
        item.pids.includes(primaryPid)
      );
      const firstSeen =
        primarySamples.at(0)?.at ??
        appRecords.at(0)?.at ??
        report.capture.nativeEnd;
      const lastSeen =
        primarySamples.at(-1)?.at ?? appRecords.at(-1)?.at ?? firstSeen;
      report.capture.applicationObservedMs = lastSeen - firstSeen;
      if (report.correlation.length > 0) {
        report.result = "observed-pipeline-pass";
      } else if (report.capture.applicationObservedMs < 3000) {
        report.result = "observation-window-insufficient";
      } else if (appRecords.length === 0) {
        report.result = "app-absence";
      } else if (content.length === 0) {
        report.result = "at-content-absence";
      } else if (
        utterances.some((utterance) =>
          content.some((item) =>
            utterance.line.toLowerCase().includes(item.text.toLowerCase())
          )
        )
      ) {
        report.result = "audio-absence";
      } else {
        report.result = "speech-absence";
      }
    }
  } catch (error) {
    report.error =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    if (native) {
      report.result = "native-failure";
    }
  } finally {
    monitoring.active = false;
    if (monitor) {
      try {
        await monitor;
      } catch (error) {
        failure.message ??= String(error);
      }
    }
    if (failure.message) {
      report.error ??= failure.message;
      if (report.result === "observed-pipeline-pass") {
        report.result = "setup-failure";
      }
    }
    report.outcomeBeforeCleanup = report.result;
    const finishedStage = report.stage;
    report.stage = "cleanup";
    for (const name of [
      "native",
      "recorder",
      "orca",
      "observer",
      "dispatcher",
      "pulse",
    ]) {
      const owned = processes.find((entry) => entry.name === name);
      if (owned) {
        try {
          await stop(owned, name === "recorder" ? "SIGINT" : "SIGTERM");
        } catch (error) {
          owned.error ??= String(error);
          owned.stopped = false;
        }
      }
    }
    if (report.audio.dataOffset > 0) {
      try {
        const audio = await readFile(audioOutput);
        const offset = report.audio.dataOffset;
        report.audio.bytes = audio.length;
        report.audio.finalized =
          audio.readUInt32LE(4) + 8 === audio.length &&
          audio.readUInt32LE(offset - 4) === audio.length - offset;
        report.audio.frames = Math.floor((audio.length - offset) / 2);
        report.audio.durationSeconds =
          report.audio.frames / report.audio.sampleRate;
        let squares = 0;
        for (let index = offset; index + 2 <= audio.length; index += 2) {
          const value = audio.readInt16LE(index);
          if (value !== 0) {
            report.audio.nonzero += 1;
          }
          report.audio.peak = Math.max(report.audio.peak, Math.abs(value));
          squares += value * value;
        }
        report.audio.rms =
          report.audio.frames > 0
            ? Math.sqrt(squares / report.audio.frames)
            : 0;
      } catch (error) {
        report.error ??= String(error);
      }
    }
    report.cleanup.owned = processes.every(
      (owned) =>
        owned.stopped &&
        !owned.forced &&
        (owned.error === null || owned.pid === 0)
    );
    try {
      if (temporary) {
        await rm(temporary, { force: true, recursive: true });
      }
      report.cleanup.temporaryDirectoryRemoved = true;
    } catch (error) {
      report.error ??= String(error);
    }
    if (
      !report.cleanup.owned ||
      !report.cleanup.temporaryDirectoryRemoved ||
      (native && !report.cleanup.native) ||
      (report.audio.frames > 0 && !report.audio.finalized)
    ) {
      report.result = "cleanup-failure";
    }
    process.off("SIGTERM", interrupted);
    process.off("SIGINT", interrupted);
    if (failure.message) {
      report.error ??= failure.message;
      if (report.result === "observed-pipeline-pass") {
        report.result = "setup-failure";
      }
    }
    report.stage = finishedStage;
    report.finishedAt = Date.now();
    await save();
    process.stdout.write(
      `AT companion ${report.result}, stage ${report.stage}.\n`
    );
    if (report.result !== "observed-pipeline-pass") {
      process.exitCode = 1;
    }
  }
};

await main();
