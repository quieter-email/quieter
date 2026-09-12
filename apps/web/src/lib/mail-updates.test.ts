import { QueryClient } from "@tanstack/react-query";
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
}

describe("mail connection lifecycle", () => {
  let dispose: (() => void) | undefined;
  const page = Object.assign(new EventTarget(), {
    hasFocus: (): boolean => true,
    visibilityState: "visible",
  });
  const windowEvents = new EventTarget();

  beforeEach(() => {
    vi.useFakeTimers();
    Socket.instances = [];
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
    await vi.advanceTimersByTimeAsync(150);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(socket.close).not.toHaveBeenCalled();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(150);
    expect(Socket.instances).toHaveLength(1);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.close).toHaveBeenCalledOnce();
    refresh.mockClear();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(150);
    expect(Socket.instances).toHaveLength(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("keeps a visible window connected after focus moves elsewhere", async () => {
    vi.spyOn(page, "hasFocus").mockReturnValue(false);
    dispose = connectMailUpdates(new QueryClient());
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    windowEvents.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(socket.close).not.toHaveBeenCalled();
  });

  test("coalesces duplicate events and cancels a handshake when the session ends", async () => {
    const client = new QueryClient();
    const refresh = vi.spyOn(client, "invalidateQueries");
    dispose = connectMailUpdates(client);
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = Socket.instances;
    socket.open();
    await vi.advanceTimersByTimeAsync(150);
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
    await vi.advanceTimersByTimeAsync(150);
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
});
