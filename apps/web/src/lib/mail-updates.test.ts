import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { connectMailUpdates } from "./mail-updates";
import { rpc } from "./orpc";

vi.mock(import("./orpc"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    rpc: {
      ...original.rpc,
      mail: {
        ...original.rpc.mail,
        createUpdateConnection: vi.fn<typeof rpc.mail.createUpdateConnection>(),
      },
    },
  };
});

class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  send = vi.fn<(data: string) => void>();
  close = vi.fn<() => void>(() => {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  });
  constructor() {
    super();
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  notify(mailboxId = "mailbox", eventId = crypto.randomUUID()) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventId, mailboxId, type: "mailbox.changed" }),
      })
    );
  }
}

describe("mail connection lifecycle", () => {
  let dispose: (() => void) | undefined;
  let focused = true;
  const page = Object.assign(new EventTarget(), {
    hasFocus: (): boolean => focused,
    visibilityState: "visible",
  });
  const windowEvents = new EventTarget();

  beforeEach(() => {
    vi.useFakeTimers();
    Socket.instances = [];
    focused = true;
    page.visibilityState = "visible";
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", windowEvents);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("WebSocket", Socket);
    vi.mocked(rpc.mail.createUpdateConnection).mockResolvedValue({
      url: "ws://localhost/mail/live",
    });
  });
  afterEach(() => {
    dispose?.();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("keeps a connection through short background visits, closes after 30 seconds and reconciles on return", async () => {
    const client = new QueryClient();
    const refresh = vi.spyOn(client, "invalidateQueries");
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(10_000);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(socket.close).not.toHaveBeenCalled();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Socket.instances).toHaveLength(1);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.close).toHaveBeenCalledOnce();
    refresh.mockClear();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Socket.instances).toHaveLength(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test.each(["blur", "hidden"])(
    "defers notifications and recovery refreshes while inactive (%s), then reconciles once",
    async (activity) => {
      const client = new QueryClient();
      const refresh = vi.spyOn(client, "invalidateQueries");
      dispose = connectMailUpdates(client);
      await vi.advanceTimersByTimeAsync(0);
      const [socket] = Socket.instances;
      socket.open();
      await vi.advanceTimersByTimeAsync(10_000);
      refresh.mockClear();
      focused = activity !== "blur";
      page.visibilityState = activity === "hidden" ? "hidden" : "visible";
      windowEvents.dispatchEvent(new Event("blur"));
      page.dispatchEvent(new Event("visibilitychange"));
      for (let index = 0; index < 100; index += 1) {
        socket.notify();
      }
      await vi.advanceTimersByTimeAsync(10_000);
      expect(socket.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(refresh).not.toHaveBeenCalled();
      focused = true;
      page.visibilityState = "visible";
      windowEvents.dispatchEvent(new Event("focus"));
      page.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      Socket.instances.at(-1)?.open();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(refresh).toHaveBeenCalledOnce();
    }
  );

  test("coalesces duplicate events and cancels a handshake when the session ends", async () => {
    const client = new QueryClient();
    const refresh = vi.spyOn(client, "invalidateQueries");
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(10_000);
    refresh.mockClear();
    const event = {
      eventId: crypto.randomUUID(),
      mailboxId: "mailbox",
      type: "mailbox.changed",
    };
    socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(event) })
    );
    socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(event) })
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledOnce();
    dispose();
    const handshake = Promise.withResolvers<{ url: string }>();
    vi.mocked(rpc.mail.createUpdateConnection).mockReturnValueOnce(
      handshake.promise
    );
    dispose = connectMailUpdates(client);
    dispose();
    handshake.resolve({ url: "ws://localhost/mail/live" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(Socket.instances).toHaveLength(1);
  });

  test("batches a sustained stream of distinct events without starving updates or refreshing unrelated mailboxes", async () => {
    const client = new QueryClient();
    let revision = 0;
    const fetchMessages = vi.fn<() => number>(() => revision);
    const fetchOtherMessages = vi.fn<() => number>().mockReturnValue(0);
    const observer = new QueryObserver(client, {
      initialData: revision,
      queryFn: fetchMessages,
      queryKey: ["messages", "mailbox", "inbox", ""],
      staleTime: Infinity,
    });
    const otherObserver = new QueryObserver(client, {
      initialData: 0,
      queryFn: fetchOtherMessages,
      queryKey: ["messages", "other-mailbox", "inbox", ""],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const unsubscribeOther = otherObserver.subscribe(() => {});
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(10_000);
    fetchMessages.mockClear();
    fetchOtherMessages.mockClear();
    for (let index = 0; index < 100; index += 1) {
      revision += 1;
      socket.notify();
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(observer.getCurrentResult().data).toBeGreaterThan(0);
    expect(fetchMessages.mock.calls.length).toBeLessThan(10);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observer.getCurrentResult().data).toBe(revision);
    expect(fetchOtherMessages).not.toHaveBeenCalled();
    const settledCount = fetchMessages.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMessages).toHaveBeenCalledTimes(settledCount);
    unsubscribe();
    unsubscribeOther();
    client.clear();
  });

  test("retains changes received during an in-flight refresh for a single follow-up", async () => {
    const client = new QueryClient();
    const refresh = vi.spyOn(client, "invalidateQueries");
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(10_000);
    refresh.mockClear();
    // oxlint-disable-next-line typescript/no-invalid-void-type -- Query invalidation resolves without a value.
    const inFlight = Promise.withResolvers<void>();
    refresh.mockReturnValueOnce(inFlight.promise);
    socket.notify();
    await vi.advanceTimersByTimeAsync(10_000);
    for (let index = 0; index < 100; index += 1) {
      socket.notify();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledOnce();
    inFlight.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
