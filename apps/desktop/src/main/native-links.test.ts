import { describe, expect, it, vi } from "vite-plus/test";

import { parseNativeMailTarget } from "../shared/native-links";
import type { NativeMailTarget } from "../shared/native-links";
import { NativeLinkInbox } from "./native-links";

const target: NativeMailTarget = {
  kind: "mail",
  mailboxId: "mailbox-one",
  messageId: "message-one",
  threadId: "thread-one",
};
const firstSession = { sessionId: "session-one", userId: "user-one" };

describe("native mail URL boundary", () => {
  it("preserves the existing mailto contract and accepts scoped content links", () => {
    const input =
      "mailto:person%2Btag@example.test?cc=other@example.test&subject=Subject&body=First%0ASecond";
    const mailto = parseNativeMailTarget(input);
    expect(mailto).toMatchObject({ kind: "mailto", url: input });
    expect(
      parseNativeMailTarget(
        "com.quieter.desktop:/mail?mailboxId=mailbox-one&threadId=thread-one&messageId=message-one"
      )
    ).toMatchObject(target);
  });

  it("rejects foreign navigation and ambiguous mailbox identifiers", () => {
    for (const input of [
      "https://example.test/mail?mailboxId=one&threadId=two&messageId=three",
      "file:///mail?mailboxId=one&threadId=two&messageId=three",
      "quieter-app://app/mail?mailboxId=one&threadId=two&messageId=three",
      "com.quieter.desktop://mail?mailboxId=one&threadId=two&messageId=three",
      "com.quieter.desktop:/auth/callback#token=secret",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=two&messageId=three#secret",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=two&messageId=three&token=secret",
      "com.quieter.desktop:/mail?mailboxId=one&mailboxId=other&threadId=two&messageId=three",
      "com.quieter.desktop:/mail?mailboxId=&threadId=two&messageId=three",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=%0Aother&messageId=three",
      "com.quieter.desktop:/mail?mailboxId=%20&threadId=two&messageId=three",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=two",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=two&messageId=",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=two&messageId=%0Athree",
      "com.quieter.desktop:/mail?mailboxId=one&threadId=two&messageId=three&messageId=other",
      "mailto://example.test/path",
      " mailto:person@example.test",
      "mailto:bad%0D%0Arecipient@example.test",
      "mailto:bad%ZZ@example.test",
      "mailto:person@example.test\n",
      `mailto:${"x".repeat(100_000)}`,
    ]) {
      expect(parseNativeMailTarget(input)).toBeNull();
    }
  });
});

describe("native link session ownership", () => {
  it("retains an early link and allows only one concurrent consumption", async () => {
    const inbox = new NativeLinkInbox({
      getSession: async () => await Promise.resolve(firstSession),
      onPending: vi.fn<() => void>(),
    });
    await inbox.receive(target);
    await inbox.start();
    const intent = await inbox.read({
      assertCurrent: vi.fn<() => void>(),
      input: { kind: "peek", userId: firstSession.userId },
    });
    expect(intent?.target).toMatchObject(target);
    if (!intent) {
      throw new Error("Expected an authorized intent.");
    }
    const results = await Promise.all(
      [1, 2].map(
        async () =>
          await inbox.read({
            assertCurrent: vi.fn<() => void>(),
            input: { id: intent.id, kind: "take", userId: firstSession.userId },
          })
      )
    );
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("rejects old account and replaced-session intents", async () => {
    let session = firstSession;
    const inbox = new NativeLinkInbox({
      getSession: async () => await Promise.resolve(session),
      onPending: vi.fn<() => void>(),
    });
    await inbox.start();
    for (const replacement of [
      { sessionId: "another-session", userId: "another-user" },
      { ...firstSession, sessionId: "replacement-session" },
    ]) {
      session = firstSession;
      await inbox.receive(target);
      const intent = await inbox.read({
        assertCurrent: vi.fn<() => void>(),
        input: { kind: "peek", userId: firstSession.userId },
      });
      if (!intent) {
        throw new Error("Expected a pending intent.");
      }
      session = replacement;
      await expect(
        inbox.read({
          assertCurrent: vi.fn<() => void>(),
          input: { id: intent.id, kind: "take", userId: replacement.userId },
        })
      ).resolves.toBeNull();
    }
  });

  it("preserves only verified signed-out links across authentication", async () => {
    let session: typeof firstSession | null = null;
    const inbox = new NativeLinkInbox({
      getSession: async () => await Promise.resolve(session),
      onPending: vi.fn<() => void>(),
    });
    await inbox.start();
    await inbox.receive(target);
    inbox.beginAuthentication();
    session = firstSession;
    const intent = await inbox.read({
      assertCurrent: vi.fn<() => void>(),
      input: { kind: "peek", userId: firstSession.userId },
    });
    expect(intent?.target).toMatchObject(target);
    inbox.beginAuthentication();
    await expect(
      inbox.read({
        assertCurrent: vi.fn<() => void>(),
        input: { kind: "peek", userId: firstSession.userId },
      })
    ).resolves.toBeNull();
    const early = new NativeLinkInbox({
      getSession: async () => await Promise.resolve(firstSession),
      onPending: vi.fn<() => void>(),
    });
    await early.receive(target);
    early.beginAuthentication();
    await early.start();
    await expect(
      early.read({
        assertCurrent: vi.fn<() => void>(),
        input: { kind: "peek", userId: firstSession.userId },
      })
    ).resolves.toBeNull();
  });

  it("does not revive pending work after sign-out during session lookup", async () => {
    const lookup = Promise.withResolvers<typeof firstSession>();
    const inbox = new NativeLinkInbox({
      getSession: async () => await lookup.promise,
      onPending: vi.fn<() => void>(),
    });
    await inbox.start();
    const received = inbox.receive(target);
    inbox.clear();
    lookup.resolve(firstSession);
    await received;
    await expect(
      inbox.read({
        assertCurrent: vi.fn<() => void>(),
        input: { kind: "peek", userId: firstSession.userId },
      })
    ).resolves.toBeNull();
  });

  it("keeps a newer receipt when an older peek or take completes", async () => {
    let lookup = Promise.resolve(firstSession);
    const inbox = new NativeLinkInbox({
      getSession: async () => await lookup,
      onPending: vi.fn<() => void>(),
    });
    await inbox.start();
    await inbox.receive(target);
    const old = await inbox.read({
      assertCurrent: vi.fn<() => void>(),
      input: { kind: "peek", userId: firstSession.userId },
    });
    if (!old) {
      throw new Error("Expected an initial intent.");
    }
    const slow = Promise.withResolvers<typeof firstSession>();
    lookup = slow.promise;
    const reading = inbox.read({
      assertCurrent: vi.fn<() => void>(),
      input: { id: old.id, kind: "take", userId: firstSession.userId },
    });
    lookup = Promise.resolve(firstSession);
    await inbox.receive({ ...target, threadId: "new-thread" });
    slow.resolve(firstSession);
    await expect(reading).resolves.toBeNull();
    await expect(
      inbox.read({
        assertCurrent: vi.fn<() => void>(),
        input: { kind: "peek", userId: firstSession.userId },
      })
    ).resolves.toMatchObject({ target: { threadId: "new-thread" } });
  });

  it("keeps an intent private when the invoking renderer changes", async () => {
    const inbox = new NativeLinkInbox({
      getSession: async () => await Promise.resolve(firstSession),
      onPending: vi.fn<() => void>(),
    });
    await inbox.start();
    await inbox.receive(target);
    await expect(
      inbox.read({
        assertCurrent: () => {
          throw new Error("Frame replaced");
        },
        input: { kind: "peek", userId: firstSession.userId },
      })
    ).rejects.toThrow(/Frame/u);
  });

  it("does not treat a failed session lookup as verified sign-out", async () => {
    let available = false;
    const inbox = new NativeLinkInbox({
      getSession: async () => {
        if (!available) {
          throw new Error("Session lookup unavailable");
        }
        return await Promise.resolve(firstSession);
      },
      onPending: vi.fn<() => void>(),
    });
    await inbox.start();
    await expect(inbox.receive(target)).rejects.toThrow(/unavailable/u);
    inbox.beginAuthentication();
    available = true;
    await expect(
      inbox.read({
        assertCurrent: vi.fn<() => void>(),
        input: { kind: "peek", userId: firstSession.userId },
      })
    ).resolves.toBeNull();
  });
});
