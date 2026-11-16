/* oxlint-disable require-await -- Async transport mocks follow promise-function-async. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runManagementCli } from "../src/index";

const mutationId = "72b92a77-d43a-483d-99a2-e28b6e8c8423";
const preparation = {
  idempotencyKey: "retained-key",
  openTrackingEnabled: false,
  organizationId: "organization",
};
const reviewBase = {
  createdAt: "2026-11-15T10:00:00Z",
  expiresAt: "2026-11-15T11:00:00Z",
  id: mutationId,
  operation: "organization.settings.update",
  organizationId: "organization",
  organizationName: "Team",
  patch: { openTrackingEnabled: false },
  reviewPath: `/control/review?approvalId=${mutationId}`,
};

describe("management command credential boundaries", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  it.each([
    { command: ["execute", "settings.read"], input: {} },
    { command: ["prepare-settings-update"], input: preparation },
    { command: ["review-mutation"], input: { id: mutationId } },
    { command: ["cancel-mutation"], input: { id: mutationId } },
  ])(
    "binds session credentials to their configured origin for $command",
    async ({ command, input }) => {
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
          ...command,
          "--origin",
          "https://app.example.com",
          "--session-file",
          sessionFile,
          "--input",
          "-",
        ],
        fetch,
        readStdin: async () => JSON.stringify(input),
        stderr,
        stdout,
      });
      expect(code).not.toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.flat().join("")).toContain(
        "SESSION_UNAVAILABLE"
      );
      expect(stderr.mock.calls.flat().join("")).not.toContain("private");
    }
  );

  it.each([
    {
      command: "prepare-settings-update",
      input: preparation,
      path: "prepare",
      review: { ...reviewBase, status: "prepared" },
    },
    {
      command: "review-mutation",
      input: { id: mutationId },
      path: "review",
      review: {
        ...reviewBase,
        approvedAt: null,
        completedAt: "2026-11-15T10:02:00Z",
        error: { code: "CONFLICT", message: "The change cannot be completed." },
        status: "failed",
      },
    },
    {
      command: "cancel-mutation",
      input: { id: mutationId },
      path: "cancel",
      review: {
        ...reviewBase,
        approvedAt: "2026-11-15T10:01:00Z",
        completedAt: "2026-11-15T10:02:00Z",
        result: { allowPerSendOverride: true, openTrackingEnabled: false },
        status: "succeeded",
      },
    },
  ])(
    "runs $command from a file or stdin without taking another action",
    async ({ command, input, path: endpoint, review }) => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "quieter-management-cli-")
      );
      directories.push(directory);
      const sessionFile = path.join(directory, "session.json");
      const inputFile = path.join(directory, "input.json");
      await writeFile(
        sessionFile,
        JSON.stringify({
          cookie: "session=private",
          origin: "https://app.example.com",
        })
      );
      await writeFile(inputFile, JSON.stringify(input));
      for (const source of [inputFile, "-"]) {
        const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
          const request = new Request(url, init);
          expect(new URL(request.url).pathname).toBe(
            `/api/control/mutations/${endpoint}`
          );
          await expect(request.json()).resolves.toStrictEqual(input);
          expect(request.headers.has("X-Quieter-Review")).toBeFalsy();
          return Response.json(review, {
            headers: { "Quieter-Control-Version": "2026-11" },
          });
        });
        const stdout = vi.fn<(text: string) => void>();
        const stderr = vi.fn<(text: string) => void>();
        const readStdin = vi.fn<() => Promise<string>>(async () =>
          JSON.stringify(input)
        );
        const code = await runManagementCli({
          args: [
            command,
            "--origin",
            "https://app.example.com",
            "--session-file",
            sessionFile,
            "--input",
            source,
          ],
          fetch,
          readStdin,
          stderr,
          stdout,
        });
        expect(code).toBe(0);
        expect(JSON.parse(stdout.mock.calls.flat().join(""))).toMatchObject({
          id: mutationId,
          status: review.status,
        });
        expect(stdout).toHaveBeenCalledOnce();
        expect(stderr).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledOnce();
        expect(readStdin).toHaveBeenCalledTimes(source === "-" ? 1 : 0);
      }
    }
  );

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

  it.each([
    { command: "prepare-settings-update", input: "not JSON" },
    {
      command: "prepare-settings-update",
      input: JSON.stringify({ ...preparation, approvalId: "private" }),
    },
    { command: "review-mutation", input: '{"id":"private"}' },
    {
      command: "review-mutation",
      input: JSON.stringify({ id: mutationId, organizationId: "private" }),
    },
    {
      command: "cancel-mutation",
      input: JSON.stringify({
        id: mutationId,
        patch: { openTrackingEnabled: true },
      }),
    },
  ])(
    "rejects invalid lifecycle input before loading credentials for $command",
    async ({ command, input }) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const stdout = vi.fn<(text: string) => void>();
      const stderr = vi.fn<(text: string) => void>();
      const code = await runManagementCli({
        args: [
          command,
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
      expect(stderr.mock.calls.flat().join("")).toContain("INVALID_INPUT");
      expect(stderr.mock.calls.flat().join("")).not.toContain("private");
    }
  );

  it.each([
    ["prepare-settings-update", "organization.settings.update"],
    ["review-mutation", "extra"],
    ["cancel-mutation", "extra"],
    ["approve-mutation"],
    ["review-mutation", "--confirmed"],
    ["cancel-mutation", "--cookie", "private"],
  ])(
    "rejects unsupported lifecycle grammar %j before reading input",
    async (...command) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const stdout = vi.fn<(text: string) => void>();
      const stderr = vi.fn<(text: string) => void>();
      const readStdin = vi.fn<() => Promise<string>>();
      const code = await runManagementCli({
        args: [
          ...command,
          "--origin",
          "https://app.example.com",
          "--session-file",
          "/unread-session.json",
          "--input",
          "-",
        ],
        fetch,
        readStdin,
        stderr,
        stdout,
      });
      expect(code).not.toBe(0);
      expect(readStdin).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.flat().join("")).toContain("INVALID_ARGUMENTS");
      expect(stderr.mock.calls.flat().join("")).not.toContain("private");
    }
  );

  it("reports an uncertain lifecycle failure safely without retry", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "quieter-management-cli-")
    );
    directories.push(directory);
    const sessionFile = path.join(directory, "session.json");
    await writeFile(
      sessionFile,
      JSON.stringify({
        cookie: "session=private",
        origin: "https://app.example.com",
      })
    );
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      throw new Error("private transport exception");
    });
    const stdout = vi.fn<(text: string) => void>();
    const stderr = vi.fn<(text: string) => void>();
    const code = await runManagementCli({
      args: [
        "prepare-settings-update",
        "--origin",
        "https://app.example.com",
        "--session-file",
        sessionFile,
        "--input",
        "-",
      ],
      fetch,
      readStdin: async () => JSON.stringify(preparation),
      stderr,
      stdout,
    });
    expect(code).not.toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.flat().join("")).toContain("NETWORK_ERROR");
    expect(stderr.mock.calls.flat().join("")).not.toContain("private");
  });

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
