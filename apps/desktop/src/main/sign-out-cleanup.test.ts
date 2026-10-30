import { describe, expect, it } from "vite-plus/test";

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
  });

  it("cancels pending provider work on renderer loss and ignores late completion", async () => {
    const coordinator = new SignOutCleanup();
    const provider = Promise.withResolvers<null>();
    const started = Promise.withResolvers<null>();
    const phases: string[] = [];
    const action = coordinator.run({
      send: (command) => {
        phases.push(command.phase);
        if (command.phase === "capture") {
          coordinator.acknowledge({ ...command, success: true });
        }
      },
      signOut: async () => {
        started.resolve(null);
        await provider.promise;
      },
    });
    await started.promise;
    coordinator.cancel();
    await expect(action).rejects.toThrow(/closed or reloaded/u);
    provider.resolve(null);
    await Promise.resolve();
    expect(phases).not.toContain("cleanup");
  });
});
