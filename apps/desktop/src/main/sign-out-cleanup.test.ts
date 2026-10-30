import { describe, expect, it, vi } from "vite-plus/test";

import type { SignOutCleanupCommand } from "../shared/bridge";
import { SignOutCleanup } from "./sign-out-cleanup";

describe("native sign-out cleanup authority", () => {
  it("captures before provider action and completes only after owned cleanup", async () => {
    const coordinator = new SignOutCleanup();
    const provider = Promise.withResolvers<null>();
    const captured = Promise.withResolvers<SignOutCleanupCommand>();
    const cleanup = Promise.withResolvers<SignOutCleanupCommand>();
    const providerEntered = Promise.withResolvers<null>();
    let providerStarted = false;
    let completed = false;
    const action = coordinator.run({
      send: (command) => {
        if (command.phase === "capture") {
          captured.resolve(command);
        } else if (command.phase === "cleanup") {
          cleanup.resolve(command);
        }
      },
      signOut: async () => {
        providerStarted = true;
        providerEntered.resolve(null);
        await provider.promise;
      },
    });
    const capture = await captured.promise;
    expect(providerStarted).toBeFalsy();
    expect(() => {
      coordinator.acknowledge({ ...capture, phase: "cleanup", success: true });
    }).toThrow(/no longer active/u);
    coordinator.acknowledge({ ...capture, success: true });
    await providerEntered.promise;
    expect(providerStarted).toBeTruthy();
    expect(() => {
      coordinator.acknowledge({ ...capture, success: true });
    }).toThrow(/no longer active/u);
    provider.resolve(null);
    const completion = await cleanup.promise;
    const finished = (async () => {
      await action;
      completed = true;
    })();
    expect(completed).toBeFalsy();
    coordinator.acknowledge({ ...completion, success: true });
    await finished;
    expect(completed).toBeTruthy();
  });

  it("releases without cleanup on provider failure and accepts a later attempt", async () => {
    const coordinator = new SignOutCleanup();
    const phases: string[] = [];
    const send = (command: SignOutCleanupCommand) => {
      phases.push(command.phase);
      if (command.phase !== "release") {
        coordinator.acknowledge({ ...command, success: true });
      }
    };
    await expect(
      coordinator.run({
        send,
        signOut: async () => {
          await Promise.reject(new Error("provider unavailable"));
        },
      })
    ).rejects.toThrow("provider unavailable");
    expect(phases).not.toContain("cleanup");
    expect(phases).toContain("release");
    await expect(
      coordinator.run({ send, signOut: async () => {} })
    ).resolves.toBeUndefined();
  });

  it("never calls the provider when renderer capture fails", async () => {
    const coordinator = new SignOutCleanup();
    let providerStarted = false;
    await expect(
      coordinator.run({
        send: (command) => {
          if (command.phase === "capture") {
            coordinator.acknowledge({ ...command, success: false });
          }
        },
        signOut: async () => {
          providerStarted = true;
          await Promise.resolve();
        },
      })
    ).rejects.toThrow(/cleanup/u);
    expect(providerStarted).toBeFalsy();
  });

  it("reports cleanup failure independently of provider success", async () => {
    const coordinator = new SignOutCleanup();
    await expect(
      coordinator.run({
        send: (command) => {
          if (command.phase !== "release") {
            coordinator.acknowledge({
              ...command,
              success: command.phase === "capture",
            });
          }
        },
        signOut: async () => {},
      })
    ).rejects.toThrow(/cleanup/u);
  });

  it("expires missing renderers without granting later cleanup authority", async () => {
    const coordinator = new SignOutCleanup();
    const commands: SignOutCleanupCommand[] = [];
    let providerStarted = false;
    await expect(
      coordinator.run({
        send: (command) => {
          commands.push(command);
        },
        signOut: async () => {
          providerStarted = true;
          await Promise.resolve();
        },
        timeoutMs: 1,
      })
    ).rejects.toThrow(/timed out/u);
    expect(providerStarted).toBeFalsy();
    expect(() => {
      coordinator.acknowledge({ ...commands[0], success: true });
    }).toThrow(/no longer active/u);
    await expect(
      coordinator.run({
        send: (command) => {
          if (command.phase !== "release") {
            coordinator.acknowledge({ ...command, success: true });
          }
        },
        signOut: async () => {},
      })
    ).resolves.toBeUndefined();
  });

  it.each(["timeout", "cancel"] as const)(
    "retains cleanup authority after caller %s until the provider settles",
    async (interruption) => {
      vi.useFakeTimers();
      try {
        const coordinator = new SignOutCleanup();
        const provider = Promise.withResolvers<null>();
        const started = Promise.withResolvers<null>();
        const cleaned = Promise.withResolvers<null>();
        let completed = false;
        const phases: string[] = [];
        const action = coordinator.run({
          onSignedOut: () => {
            completed = true;
          },
          send: (command) => {
            phases.push(command.phase);
            if (command.phase === "release") {
              cleaned.resolve(null);
            } else {
              coordinator.acknowledge({ ...command, success: true });
            }
          },
          signOut: async () => {
            started.resolve(null);
            await provider.promise;
          },
        });
        await started.promise;
        const rejected = (async () => {
          await expect(action).rejects.toThrow(
            interruption === "timeout" ? /timed out/u : /closed or reloaded/u
          );
        })();
        if (interruption === "timeout") {
          await vi.advanceTimersByTimeAsync(30_000);
        } else {
          coordinator.cancel();
        }
        await rejected;
        await expect(
          coordinator.run({ send: () => {}, signOut: async () => {} })
        ).rejects.toThrow(/already in progress/u);
        expect(phases).not.toContain("release");
        provider.resolve(null);
        await cleaned.promise;
        expect(phases).toContain("cleanup");
        expect(completed).toBeTruthy();
        await expect(
          coordinator.run({
            send: (command) => {
              if (command.phase !== "release") {
                coordinator.acknowledge({ ...command, success: true });
              }
            },
            signOut: async () => {},
          })
        ).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each(["reject", "missing-ack", "missing-renderer", "notify"] as const)(
    "releases late completion and reports only post-sign-out failure for %s",
    async (failure) => {
      vi.useFakeTimers();
      try {
        const coordinator = new SignOutCleanup();
        const provider = Promise.withResolvers<null>();
        const started = Promise.withResolvers<null>();
        const released = Promise.withResolvers<null>();
        let notified = false;
        let reported = false;
        let cleanupRequested = false;
        const action = coordinator.run({
          onCompletionError: () => {
            reported = true;
          },
          onSignedOut: () => {
            notified = true;
            if (failure === "notify") {
              throw new Error("notification failed");
            }
          },
          send: (command) => {
            if (command.phase === "capture") {
              coordinator.acknowledge({ ...command, success: true });
            } else if (command.phase === "cleanup") {
              cleanupRequested = true;
              if (failure === "missing-renderer") {
                throw new Error("window destroyed");
              }
              if (failure === "notify") {
                coordinator.acknowledge({ ...command, success: true });
              }
            } else {
              released.resolve(null);
            }
          },
          signOut: async () => {
            started.resolve(null);
            await provider.promise;
          },
        });
        await started.promise;
        const rejected = (async () => {
          await expect(action).rejects.toThrow(/timed out/u);
        })();
        await vi.advanceTimersByTimeAsync(30_000);
        await rejected;
        if (failure === "reject") {
          provider.reject(new Error("provider failed"));
        } else {
          provider.resolve(null);
        }
        await vi.advanceTimersByTimeAsync(30_000);
        await released.promise;
        expect(reported).toBe(failure !== "reject");
        expect(notified).toBe(failure !== "reject");
        expect(cleanupRequested).toBe(failure !== "reject");
        await expect(
          coordinator.run({
            send: (command) => {
              if (command.phase !== "release") {
                coordinator.acknowledge({ ...command, success: true });
              }
            },
            signOut: async () => {},
          })
        ).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    }
  );
});
