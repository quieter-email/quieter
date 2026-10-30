import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { SignOutCleanupCommand } from "../shared/bridge";
import { registerSignOutCleanup } from "./sign-out-cleanup";

const { recovery, queries } = vi.hoisted(() => ({
  queries:
    vi.fn<
      () =>
        | ((() => Promise<void>) & { isCurrent: () => Promise<boolean> })
        | undefined
    >(),
  recovery: vi.fn<() => (() => Promise<void>) | undefined>(),
}));
vi.mock(
  import("@quieter/app/lib/draft-recovery-journal"),
  async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      draftRecoveryJournal: {
        ...original.draftRecoveryJournal,
        captureCleanup: recovery,
      },
    };
  }
);
vi.mock(import("@quieter/app/lib/query-persister"), async (importOriginal) => ({
  ...(await importOriginal()),
  captureQueryPersistenceCleanup: queries,
}));
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<() => void>(),
}));

describe("renderer sign-out capture authority", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects missing authority and accepts the next bound request", async () => {
    let receive:
      | ((command: SignOutCleanupCommand) => Promise<void>)
      | undefined;
    vi.stubGlobal("window", {
      quieterDesktop: {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Registers the bridge event listener.
        onSignOutCleanup: (callback: typeof receive) => {
          receive = callback;
          return () => {};
        },
      },
    });
    const stop = registerSignOutCleanup();
    if (!receive) {
      throw new Error("Missing cleanup listener");
    }
    await expect(
      receive({ phase: "capture", requestId: "unbound" })
    ).rejects.toThrow(/session/iu);
    const clearQueries = vi.fn<() => Promise<void>>().mockResolvedValue();
    const clearRecovery = vi.fn<() => Promise<void>>().mockResolvedValue();
    queries.mockReturnValue(
      Object.assign(clearQueries, {
        isCurrent: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      })
    );
    recovery.mockReturnValue(clearRecovery);
    await receive({ phase: "capture", requestId: "bound" });
    await receive({ phase: "cleanup", requestId: "bound" });
    expect(clearQueries).toHaveBeenCalledOnce();
    expect(clearRecovery).toHaveBeenCalledOnce();
    stop();
  });

  it("attempts both observed cleanup failures and accepts a retry", async () => {
    let receive:
      | ((command: SignOutCleanupCommand) => Promise<void>)
      | undefined;
    vi.stubGlobal("window", {
      quieterDesktop: {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Registers the bridge event listener.
        onSignOutCleanup: (callback: typeof receive) => {
          receive = callback;
          return () => {};
        },
      },
    });
    const clearQueries = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("query storage denied"));
    const clearRecovery = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("recovery storage denied"));
    queries.mockReturnValue(
      Object.assign(clearQueries, {
        isCurrent: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      })
    );
    recovery.mockReturnValue(clearRecovery);
    const stop = registerSignOutCleanup();
    if (!receive) {
      throw new Error("Missing cleanup listener");
    }
    await receive({ phase: "capture", requestId: "denied" });
    await expect(
      receive({ phase: "cleanup", requestId: "denied" })
    ).rejects.toBeInstanceOf(AggregateError);
    expect(clearQueries).toHaveBeenCalledOnce();
    expect(clearRecovery).toHaveBeenCalledOnce();
    await receive({ phase: "capture", requestId: "retry" });
    await expect(
      receive({ phase: "cleanup", requestId: "retry" })
    ).rejects.toBeInstanceOf(AggregateError);
    expect(clearQueries).toHaveBeenCalledTimes(2);
    expect(clearRecovery).toHaveBeenCalledTimes(2);
    stop();
  });

  it("releases pending preparation and rejects preflight storage errors before cleanup", async () => {
    let receive:
      | ((command: SignOutCleanupCommand) => Promise<void>)
      | undefined;
    vi.stubGlobal("window", {
      quieterDesktop: {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Registers the bridge event listener.
        onSignOutCleanup: (callback: typeof receive) => {
          receive = callback;
          return () => {};
        },
      },
    });
    const clearQueries = vi.fn<() => Promise<void>>().mockResolvedValue();
    const clearRecovery = vi.fn<() => Promise<void>>().mockResolvedValue();
    const prepared = Promise.withResolvers<boolean>();
    const isCurrent = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(prepared.promise)
      .mockRejectedValueOnce(new Error("storage denied"))
      .mockResolvedValue(true);
    queries.mockReturnValue(Object.assign(clearQueries, { isCurrent }));
    recovery.mockReturnValue(clearRecovery);
    const stop = registerSignOutCleanup();
    if (!receive) {
      throw new Error("Missing cleanup listener");
    }
    const pending = receive({ phase: "capture", requestId: "cancelled" });
    await receive({ phase: "release", requestId: "cancelled" });
    await expect(
      receive({ phase: "capture", requestId: "denied" })
    ).rejects.toThrow(/denied/u);
    expect(clearQueries).not.toHaveBeenCalled();
    expect(clearRecovery).not.toHaveBeenCalled();
    await receive({ phase: "capture", requestId: "restored" });
    prepared.resolve(true);
    await expect(pending).rejects.toThrow(/no longer active/u);
    await receive({ phase: "cleanup", requestId: "restored" });
    expect(clearQueries).toHaveBeenCalledOnce();
    expect(clearRecovery).toHaveBeenCalledOnce();
    stop();
  });
});
