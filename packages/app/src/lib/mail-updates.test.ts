import { connectMailUpdates } from "@quieter/app/lib/mail-updates";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  createConnection: vi
    .fn<() => Promise<{ url: string }>>()
    .mockResolvedValue({ url: "ws://localhost/updates" }),
  notificationStatus: vi
    .fn<() => Promise<string>>()
    .mockResolvedValue("blocked"),
  showNotification: vi.fn<() => void>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- These mocks intentionally replace only the transport contracts used here.
vi.mock("@quieter/app/features/reminders/reminder-query", () => ({
  demoReminderSession: { clear: vi.fn<() => void>() },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- These mocks intentionally replace only the transport contracts used here.
vi.mock("@quieter/app/lib/orpc", () => ({
  orpc: {
    mailAgent: { threadResults: { key: () => ["thread-results"] } },
    scheduledSends: { list: { key: () => ["scheduled-sends"] } },
  },
  rpc: { mail: { createUpdateConnection: mocks.createConnection } },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- These mocks intentionally replace only the transport contracts used here.
vi.mock("@quieter/app/runtime", () => ({
  appRuntime: {
    reminderNotifications: {
      getStatus: mocks.notificationStatus,
      show: mocks.showNotification,
    },
  },
}));

class TestSocket extends EventTarget {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 1;
  close = vi.fn<() => void>(() => {
    this.dispatchEvent(new Event("close"));
  });
  send = vi.fn<() => void>();
  constructor() {
    super();
    TestSocket.instances.push(this);
  }
}
describe("mail update delivery", () => {
  let visible = true;
  let focused = true;
  let online = true;
  let windowEvents: EventTarget;
  let documentEvents: EventTarget;
  let client: QueryClient;
  let stop: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let fetchRows: ReturnType<typeof vi.fn<() => Promise<{ rows: string[] }>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    visible = true;
    focused = true;
    online = true;
    TestSocket.instances = [];
    windowEvents = new EventTarget();
    documentEvents = Object.assign(new EventTarget(), {
      hasFocus: () => focused,
    });
    Object.defineProperty(documentEvents, "visibilityState", {
      get: () => (visible ? "visible" : "hidden"),
    });
    vi.stubGlobal("window", windowEvents);
    vi.stubGlobal("document", documentEvents);
    vi.stubGlobal("navigator", {
      get onLine() {
        return online;
      },
    });
    vi.stubGlobal("WebSocket", TestSocket);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchRows = vi
      .fn<() => Promise<{ rows: string[] }>>()
      .mockResolvedValue({ rows: ["fresh"] });
    const observer = new QueryObserver(client, {
      initialData: { rows: ["old"] },
      queryFn: fetchRows,
      queryKey: ["messages", "mailbox", "inbox", "live-sync"],
      staleTime: Infinity,
    });
    unsubscribe = observer.subscribe(() => {});
  });
  afterEach(() => {
    stop?.();
    unsubscribe?.();
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const start = async () => {
    stop = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = TestSocket.instances;
    expect(socket).toBeDefined();
    socket?.dispatchEvent(new Event("open"));
    await vi.advanceTimersByTimeAsync(200);
    fetchRows.mockClear();
    if (socket === undefined) {
      throw new Error("Socket was not created");
    }
    return socket;
  };

  test("hidden arrivals refresh the observed inbox with notifications denied", async () => {
    const socket = await start();
    visible = false;
    focused = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          eventId: crypto.randomUUID(),
          mailboxId: "mailbox",
          type: "mailbox.changed",
        }),
      })
    );
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          eventId: crypto.randomUUID(),
          mailboxId: "mailbox",
          type: "mailbox.changed",
        }),
      })
    );
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          eventId: crypto.randomUUID(),
          mailboxId: "mailbox",
          reminderId: crypto.randomUUID(),
          scheduleVersion: 1,
          type: "reminders.changed",
        }),
      })
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchRows).toHaveBeenCalledOnce();
    expect(mocks.notificationStatus).toHaveBeenCalledWith();
    expect(mocks.showNotification).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
  });

  test("blur keeps delivery connected without polling hidden windows and visibility catches up", async () => {
    const socket = await start();
    focused = false;
    windowEvents.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(35_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(fetchRows).not.toHaveBeenCalled();
    visible = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetchRows).not.toHaveBeenCalled();
    visible = true;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchRows).toHaveBeenCalledOnce();
  });

  test("offline disconnects without reconnecting and disposal removes event delivery", async () => {
    const socket = await start();
    online = false;
    windowEvents.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(mocks.createConnection).toHaveBeenCalledOnce();
    expect(fetchRows).not.toHaveBeenCalled();
    stop?.();
    online = true;
    windowEvents.dispatchEvent(new Event("online"));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.createConnection).toHaveBeenCalledOnce();
    expect(fetchRows).not.toHaveBeenCalled();
  });
});
