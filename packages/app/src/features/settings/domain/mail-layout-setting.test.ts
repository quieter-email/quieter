import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const harness = vi.hoisted(() => {
  const subscriptions: ((listener: () => void) => () => void)[] = [];
  return { subscriptions };
});

vi.mock(import("react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useSyncExternalStore<Snapshot>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => Snapshot
  ): Snapshot {
    harness.subscriptions.push(subscribe);
    return getSnapshot();
  },
}));

describe("device mail layout", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    harness.subscriptions.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("keeps a chosen layout usable when persistence fails", async () => {
    const events = new EventTarget();
    const getItem = vi.fn<() => string>(() => "two-panels");
    const setItem = vi.fn<() => void>(() => {
      throw new Error("Storage denied");
    });
    vi.stubGlobal(
      "window",
      Object.assign(events, { localStorage: { getItem, setItem } })
    );
    const { setMailLayout, useMailLayout } =
      await import("./mail-layout-setting");
    useMailLayout();
    const [subscribe] = harness.subscriptions;
    const observed: string[] = [];
    const unsubscribe = subscribe?.(() => {
      observed.push(useMailLayout());
    });

    setMailLayout("one-panel");

    expect(observed).toContain("one-panel");
    expect(useMailLayout()).toBe("one-panel");
    getItem.mockImplementation(() => {
      throw new Error("Storage denied");
    });
    expect(useMailLayout()).toBe("one-panel");
    setMailLayout("two-panels");
    expect(observed).toContain("two-panels");
    unsubscribe?.();
  });

  test("synchronizes other windows, removal and clear after a local choice", async () => {
    const events = new EventTarget();
    const values = new Map<string, string>();
    vi.stubGlobal(
      "window",
      Object.assign(events, {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
      })
    );
    const { setMailLayout, useMailLayout } =
      await import("./mail-layout-setting");
    useMailLayout();
    const [subscribe] = harness.subscriptions;
    const observed: string[] = [];
    const unsubscribe = subscribe?.(() => {
      observed.push(useMailLayout());
    });
    setMailLayout("one-panel");
    const [key] = values.keys();
    if (key === undefined) {
      throw new Error("Mail layout was not saved");
    }
    values.set(key, "two-panels");
    events.dispatchEvent(
      Object.assign(new Event("storage"), { key, newValue: "two-panels" })
    );
    expect(observed.at(-1)).toBe("two-panels");
    values.set(key, "one-panel");
    events.dispatchEvent(
      Object.assign(new Event("storage"), { key, newValue: "one-panel" })
    );
    expect(observed.at(-1)).toBe("one-panel");
    values.delete(key);
    events.dispatchEvent(
      Object.assign(new Event("storage"), { key, newValue: null })
    );
    expect(observed.at(-1)).toBe("two-panels");
    setMailLayout("one-panel");
    values.clear();
    events.dispatchEvent(
      Object.assign(new Event("storage"), { key: null, newValue: null })
    );
    expect(observed.at(-1)).toBe("two-panels");
    expect(observed).toContain("one-panel");
    unsubscribe?.();
  });

  test("accepts a session choice when storage cannot be read or written", async () => {
    const events = new EventTarget();
    vi.stubGlobal(
      "window",
      Object.defineProperty(events, "localStorage", {
        get() {
          throw new Error("Storage denied");
        },
      })
    );
    const { setMailLayout, useMailLayout } =
      await import("./mail-layout-setting");
    useMailLayout();
    setMailLayout("one-panel");
    expect(useMailLayout()).toBe("one-panel");
  });

  test("restores the saved choice with a fresh device store", async () => {
    const events = new EventTarget();
    const values = new Map<string, string>();
    vi.stubGlobal(
      "window",
      Object.assign(events, {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
      })
    );
    const { setMailLayout } = await import("./mail-layout-setting");
    setMailLayout("one-panel");
    vi.resetModules();
    const { useMailLayout } = await import("./mail-layout-setting");
    expect(useMailLayout()).toBe("one-panel");
  });
});
