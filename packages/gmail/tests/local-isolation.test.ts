import { afterEach, describe, expect, test, vi } from "vite-plus/test";

describe("local Gmail isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("blocks watch changes, labels and sends before any provider request", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "local");
    vi.stubEnv("QUIETER_LOCAL_PROVIDER_MODE", "observe");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const gmail = await import("../src/service");
    await expect(
      gmail.watchGmailMailbox("test-token", "projects/test/topics/mail")
    ).rejects.toMatchObject({ status: 403 });
    await expect(gmail.stopGmailWatch("test-token")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      gmail.mutateGmailMessage("test-token", "message", {
        addLabelIds: ["STARRED"],
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      gmail.sendRawMessage("test-token", "dGVzdA==")
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reads mail in observation mode", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "local");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        emailAddress: "test@example.com",
        historyId: "123",
        messagesTotal: 0,
        threadsTotal: 0,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getGmailProfile } = await import("../src/service");
    await expect(getGmailProfile("test-token")).resolves.toMatchObject({
      emailAddress: "test@example.com",
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({ method: "GET" })
    );
  });

  test("refuses writes to accounts outside the explicit test allowlist", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "local");
    vi.stubEnv("QUIETER_LOCAL_PROVIDER_MODE", "write");
    vi.stubEnv("QUIETER_LOCAL_GMAIL_WRITE_ACCOUNTS", "dedicated@example.com");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ emailAddress: "shared@example.com" }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendRawMessage } = await import("../src/service");
    await expect(
      sendRawMessage("test-token", "dGVzdA==")
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/profile"),
      expect.objectContaining({ method: "GET" })
    );
  });

  test("keeps watch ownership separate from permission to write", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "local");
    vi.stubEnv("QUIETER_LOCAL_PROVIDER_MODE", "write");
    vi.stubEnv("QUIETER_LOCAL_GMAIL_WRITE_ACCOUNTS", "dedicated@example.com");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { stopGmailWatch } = await import("../src/service");
    await expect(stopGmailWatch("test-token")).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("allows deliberate write tests only after resolving the token's mailbox", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "local");
    vi.stubEnv("QUIETER_LOCAL_PROVIDER_MODE", "write");
    vi.stubEnv("QUIETER_LOCAL_GMAIL_WRITE_ACCOUNTS", "dedicated@example.com");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ emailAddress: "dedicated@example.com" })
      )
      .mockResolvedValueOnce(Response.json({ id: "sent", threadId: "thread" }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendRawMessage } = await import("../src/service");
    await expect(
      sendRawMessage("test-token", "dGVzdA==")
    ).resolves.toMatchObject({ id: "sent" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/profile"),
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/messages/send"),
      expect.objectContaining({ method: "POST" })
    );
  });

  test("checks write authority after the awaited development account lookup", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "local");
    vi.stubEnv("QUIETER_LOCAL_PROVIDER_MODE", "write");
    vi.stubEnv("QUIETER_LOCAL_GMAIL_WRITE_ACCOUNTS", "dedicated@example.com");
    let allowed = true;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = url instanceof Request ? url.url : String(url);
      if (path.endsWith("/profile")) {
        await Promise.resolve();
        allowed = false;
        return Response.json({ emailAddress: "dedicated@example.com" });
      }
      return Response.json({ id: "sent", threadId: "thread" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { sendRawMessage } = await import("../src/service");
    const sending = sendRawMessage(
      "test-token",
      "dGVzdA==",
      undefined,
      undefined,
      async () => {
        if (!allowed) {
          throw new Error("Authority revoked during preparation");
        }
        await Promise.resolve();
      }
    );
    await expect(sending).rejects.toThrow(/revoked/u);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          (url instanceof Request ? url.url : String(url)).includes(
            "/messages/send"
          ) && options?.method === "POST"
      )
    ).toBeFalsy();
  });

  test("rechecks authority on each metadata write", async () => {
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "production");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const { batchModifyMessages } = await import("../src/service");
    let allowed = true;
    const beforeEffect = async () => {
      if (!allowed) {
        throw new Error("Authority changed before the next batch");
      }
      await Promise.resolve();
    };
    await batchModifyMessages(
      "test-token",
      ["first"],
      { addLabelIds: ["STARRED"] },
      undefined,
      beforeEffect
    );
    allowed = false;
    await expect(
      batchModifyMessages(
        "test-token",
        ["second"],
        { addLabelIds: ["STARRED"] },
        undefined,
        beforeEffect
      )
    ).rejects.toThrow(/Authority changed/u);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
