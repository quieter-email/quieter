/* oxlint-disable require-await -- Async transport mocks follow promise-function-async. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runManagementCli } from "../src/index";

describe("management command credential boundaries", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  it("binds session credentials to their configured origin before transmission", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "quieter-management-cli-")
    );
    directories.push(directory);
    const sessionFile = path.join(directory, "session.json");
    await writeFile(
      sessionFile,
      JSON.stringify({
        cookie: "session=private",
        origin: "https://other.example.com",
      })
    );
    const fetch = vi.fn<typeof globalThis.fetch>();
    const stdout = vi.fn<(text: string) => void>();
    const stderr = vi.fn<(text: string) => void>();
    const code = await runManagementCli({
      args: [
        "execute",
        "settings.read",
        "--origin",
        "https://app.example.com",
        "--session-file",
        sessionFile,
        "--input",
        "-",
      ],
      fetch,
      readStdin: async () => "{}",
      stderr,
      stdout,
    });
    expect(code).not.toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.flat().join("")).not.toContain("private");
  });

  it("parses stdin parameters and sends only the origin-bound session", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "quieter-management-cli-")
    );
    directories.push(directory);
    const sessionFile = path.join(directory, "session.json");
    await writeFile(
      sessionFile,
      JSON.stringify({
        cookie: "session=private",
        origin: "https://app.example.com/",
      })
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const request = new Request(url, init);
      expect(request.headers.get("cookie")).toBe("session=private");
      expect(request.redirect).toBe("error");
      return Response.json(
        { timeFormat: "24h", weekStartsOn: 1 },
        { headers: { "Quieter-Control-Version": "2026-11" } }
      );
    });
    const stdout = vi.fn<(text: string) => void>();
    const stderr = vi.fn<(text: string) => void>();
    const code = await runManagementCli({
      args: [
        "execute",
        "settings.read",
        "--origin",
        "https://app.example.com",
        "--session-file",
        sessionFile,
        "--input",
        "-",
      ],
      fetch,
      readStdin: async () => "{}",
      stderr,
      stdout,
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.mock.calls.flat().join(""))).toMatchObject({
      timeFormat: "24h",
      weekStartsOn: 1,
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(["not JSON", '{"unrecognized":"private"}'])(
    "rejects invalid input before loading credentials",
    async (input) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const stdout = vi.fn<(text: string) => void>();
      const stderr = vi.fn<(text: string) => void>();
      const code = await runManagementCli({
        args: [
          "execute",
          "settings.read",
          "--origin",
          "https://app.example.com",
          "--session-file",
          "/unread-session.json",
          "--input",
          "-",
        ],
        fetch,
        readStdin: async () => input,
        stderr,
        stdout,
      });
      expect(code).not.toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.flat().join("")).not.toContain("private");
    }
  );

  it("does not accept credentials as flags or require credentials for help", async () => {
    const stdout = vi.fn<(text: string) => void>();
    const stderr = vi.fn<(text: string) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const readStdin = vi.fn<() => Promise<string>>();
    await expect(
      runManagementCli({
        args: ["execute", "settings.read", "--cookie", "private"],
        fetch,
        readStdin,
        stderr,
        stdout,
      })
    ).resolves.not.toBe(0);
    expect(stderr.mock.calls.flat().join("")).not.toContain("private");
    await expect(
      runManagementCli({
        args: ["--help"],
        fetch,
        readStdin,
        stderr,
        stdout,
      })
    ).resolves.toBe(0);
    expect(readStdin).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
