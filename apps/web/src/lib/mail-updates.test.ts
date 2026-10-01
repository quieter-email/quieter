import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { ListMessagesPageResult } from "./mail";
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
  notify(
    mailboxId = "mailbox",
    eventId = crypto.randomUUID(),
    revision?: string,
    type = "mailbox.changed"
  ) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventId, mailboxId, revision, type }),
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

  test("coalesces a burst without refreshing unrelated mailboxes", async () => {
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
    await vi.advanceTimersToNextTimerAsync();
    fetchMessages.mockClear();
    fetchOtherMessages.mockClear();
    for (let index = 0; index < 100; index += 1) {
      revision += 1;
      socket.notify();
    }
    await vi.advanceTimersToNextTimerAsync();
    expect(fetchMessages).toHaveBeenCalledOnce();
    expect(observer.getCurrentResult().data).toBe(revision);
    expect(fetchOtherMessages).not.toHaveBeenCalled();
    unsubscribe();
    unsubscribeOther();
    client.clear();
  });

  test("uses incremental sync, discards covered notifications and promptly syncs a newer revision", async () => {
    const client = new QueryClient();
    let revision = 0;
    const initial = { historyId: String(revision), messages: [] };
    const fetchMessages = vi
      .fn<() => ListMessagesPageResult>()
      .mockReturnValue(initial);
    const list = new QueryObserver(client, {
      initialData: initial,
      queryFn: fetchMessages,
      queryKey: ["messages", "mailbox", "inbox", ""],
      staleTime: Infinity,
    });
    // oxlint-disable-next-line eslint/require-await -- The query function has a promise contract.
    const sync = vi.fn<() => Promise<ListMessagesPageResult>>(async () => ({
      historyId: String(revision),
      messages: [],
    }));
    const live = new QueryObserver(client, {
      initialData: initial,
      queryFn: sync,
      queryKey: ["messages", "mailbox", "inbox", "", "live-sync"],
      staleTime: Infinity,
    });
    const unsubscribeList = list.subscribe(() => {});
    const unsubscribeLive = live.subscribe(() => {});
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(1000);
    sync.mockClear();
    const inFlight = Promise.withResolvers<ListMessagesPageResult>();
    sync.mockReturnValueOnce(inFlight.promise);
    for (let index = 0; index < 100; index += 1) {
      revision += 1;
      socket.notify("mailbox", crypto.randomUUID(), String(revision));
      await vi.advanceTimersByTimeAsync(200);
    }
    inFlight.resolve({ historyId: String(revision), messages: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledOnce();
    socket.notify("mailbox", crypto.randomUUID(), String(revision - 1));
    socket.notify("mailbox", crypto.randomUUID(), String(revision));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledOnce();
    revision += 1;
    socket.notify("mailbox", crypto.randomUUID(), String(revision));
    await vi.advanceTimersByTimeAsync(1000);
    expect(live.getCurrentResult().data?.historyId).toBe(String(revision));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(fetchMessages).not.toHaveBeenCalled();
    unsubscribeList();
    unsubscribeLive();
    client.clear();
  });

  test("background processing details do not trigger another mail list refresh", async () => {
    const client = new QueryClient();
    const fetchMessages = vi.fn<() => string>().mockReturnValue("mail");
    const fetchDetails = vi.fn<() => string>().mockReturnValue("details");
    const list = new QueryObserver(client, {
      initialData: "mail",
      queryFn: fetchMessages,
      queryKey: ["messages", "mailbox", "inbox", ""],
      staleTime: Infinity,
    });
    const details = new QueryObserver(client, {
      initialData: "details",
      queryFn: fetchDetails,
      queryKey: ["gmail-useful-details", "mailbox"],
      staleTime: Infinity,
    });
    const unsubscribeList = list.subscribe(() => {});
    const unsubscribeDetails = details.subscribe(() => {});
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(1000);
    fetchMessages.mockClear();
    fetchDetails.mockClear();
    socket.notify("mailbox", crypto.randomUUID(), undefined, "details.changed");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchDetails).toHaveBeenCalledOnce();
    expect(fetchMessages).not.toHaveBeenCalled();
    unsubscribeList();
    unsubscribeDetails();
    client.clear();
  });

  test("a covered message revision still updates stale unread counts", async () => {
    const client = new QueryClient();
    const sync = vi
      .fn<() => ListMessagesPageResult>()
      .mockReturnValue({ historyId: "10", messages: [] });
    const counts = vi.fn<() => number>().mockReturnValue(1);
    const fetchMailboxes = vi
      .fn<() => { unreadCount: number }[]>()
      .mockReturnValue([{ unreadCount: 1 }]);
    const mailboxes = new QueryObserver(client, {
      initialData: [{ unreadCount: 0 }],
      queryFn: fetchMailboxes,
      queryKey: ["mailboxes"],
      staleTime: Infinity,
    });
    const live = new QueryObserver(client, {
      initialData: { historyId: "0", messages: [] },
      queryFn: sync,
      queryKey: ["messages", "mailbox", "inbox", "", "live-sync"],
      staleTime: Infinity,
    });
    const unread = new QueryObserver(client, {
      initialData: 0,
      queryFn: counts,
      queryKey: ["gmail-unread-counts"],
      staleTime: Infinity,
    });
    const unsubscribeLive = live.subscribe(() => {});
    const unsubscribeUnread = unread.subscribe(() => {});
    const unsubscribeMailboxes = mailboxes.subscribe(() => {});
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(1000);
    sync.mockClear();
    counts.mockClear();
    fetchMailboxes.mockClear();
    client.setQueryData(["mailboxes"], [{ unreadCount: 0 }]);
    client.setQueryData(["gmail-unread-counts"], 0, {
      updatedAt: Date.now() - 1000,
    });
    socket.notify("mailbox", crypto.randomUUID(), "10");
    await vi.advanceTimersByTimeAsync(1000);
    expect(unread.getCurrentResult().data).toBe(1);
    expect(counts).toHaveBeenCalledOnce();
    expect(mailboxes.getCurrentResult().data?.[0].unreadCount).toBe(1);
    expect(sync).not.toHaveBeenCalled();
    unsubscribeLive();
    unsubscribeUnread();
    unsubscribeMailboxes();
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
