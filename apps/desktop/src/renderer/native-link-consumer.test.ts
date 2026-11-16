import { describe, expect, it, vi } from "vite-plus/test";

import { NativeLinkInbox } from "../main/native-links";
import type { NativeMailTarget } from "../shared/native-links";
import { NativeLinkConsumer } from "./native-link-consumer";
import type { NativeMailNavigation } from "./native-link-consumer";

type ConsumerOptions = ConstructorParameters<typeof NativeLinkConsumer>[0];

const createScenario = async (target: NativeMailTarget) => {
  const state: {
    session: { sessionId: string; userId: string };
    user: { id: string; needsOnboarding: boolean };
    mailboxes: Awaited<ReturnType<ConsumerOptions["listMailboxes"]>>;
  } = {
    mailboxes: {
      groups: [
        { mailboxes: [{ capabilities: { categories: ["inbox"] }, id: "one" }] },
      ],
    },
    session: { sessionId: "session", userId: "owner" },
    user: { id: "owner", needsOnboarding: false },
  };
  const inbox = new NativeLinkInbox({
    getSession: async () => await Promise.resolve(state.session),
    onPending: vi.fn<() => void>(),
  });
  await inbox.start();
  await inbox.receive(target);
  const navigations: NativeMailNavigation[] = [];
  const errors: unknown[] = [];
  const listMailboxes = vi.fn<ConsumerOptions["listMailboxes"]>(
    async () => await Promise.resolve(state.mailboxes)
  );
  const options: ConsumerOptions = {
    listMailboxes,
    nativeLinks: {
      read: async (input) =>
        await inbox.read({ assertCurrent: vi.fn<() => void>(), input }),
    },
    navigate: async (navigation) => {
      navigations.push(navigation);
      await Promise.resolve();
    },
    onError: (error) => {
      errors.push(error);
    },
    readUser: async () => await Promise.resolve(state.user),
    userId: "owner",
  };
  const consumer = new NativeLinkConsumer(options);
  return {
    consumer,
    errors,
    inbox,
    listMailboxes,
    navigations,
    options,
    state,
  };
};

describe("desktop native link consumption", () => {
  it("retains a mailto intent through onboarding without remapping its draft", async () => {
    const scenario = await createScenario({
      kind: "mailto",
      url: "mailto:person@example.test?bcc=other@example.test&body=First%0ASecond",
    });
    scenario.state.user.needsOnboarding = true;
    await scenario.consumer.consume();
    expect(scenario.navigations).toHaveLength(0);
    scenario.state.user.needsOnboarding = false;
    await scenario.consumer.consume();
    expect(scenario.navigations).toHaveLength(1);
    const [navigation] = scenario.navigations;
    if (navigation?.kind !== "mailto") {
      throw new Error("Expected mailto navigation.");
    }
    expect(navigation.url).toContain("bcc=");
    expect(scenario.errors).toHaveLength(0);
  });

  it("opens off-list content with its supplied identity and supported category", async () => {
    const scenario = await createScenario({
      kind: "mail",
      mailboxId: "one",
      messageId: "archived-message",
      threadId: "archived-thread",
    });
    scenario.state.mailboxes.groups = [
      { mailboxes: [{ capabilities: { categories: ["sent"] }, id: "one" }] },
    ];
    await scenario.consumer.consume();
    expect(scenario.navigations).toContainEqual(
      expect.objectContaining({
        mailbox: "sent",
        mailboxId: "one",
        messageId: "archived-message",
        threadId: "archived-thread",
      })
    );
  });

  it("never substitutes another mailbox and recovers when access returns", async () => {
    const scenario = await createScenario({
      kind: "mail",
      mailboxId: "one",
      messageId: "message",
      threadId: "thread",
    });
    scenario.state.mailboxes.groups = [
      { mailboxes: [{ capabilities: { categories: ["inbox"] }, id: "other" }] },
    ];
    await scenario.consumer.consume();
    expect(scenario.navigations).toHaveLength(0);
    expect(scenario.errors).toContainEqual(
      expect.objectContaining({ status: 403 })
    );
    scenario.state.mailboxes.groups = [
      { mailboxes: [{ capabilities: { categories: ["inbox"] }, id: "one" }] },
    ];
    await scenario.consumer.consume();
    expect(scenario.navigations).toHaveLength(1);
  });

  it("does not open a previous account intent after a shared mailbox lookup", async () => {
    const scenario = await createScenario({
      kind: "mail",
      mailboxId: "one",
      messageId: "message",
      threadId: "thread",
    });
    const openedBy: string[] = [];
    const legacyCapableAdapter = {
      ...scenario.options,
      getThread: async (
        target: Extract<NativeMailTarget, { kind: "mail" }>
      ) => {
        openedBy.push(scenario.state.session.userId);
        return await Promise.resolve({
          messages: [{ id: target.messageId, threadId: target.threadId }],
          threadId: target.threadId,
        });
      },
    };
    const consumer = new NativeLinkConsumer(legacyCapableAdapter);
    scenario.listMailboxes.mockImplementation(async () => {
      scenario.state.session = { sessionId: "replacement", userId: "other" };
      return await Promise.resolve(scenario.state.mailboxes);
    });
    await consumer.consume();
    expect(openedBy).toHaveLength(0);
    expect(scenario.navigations).toHaveLength(0);
    expect(scenario.errors).toHaveLength(0);
  });

  it("keeps a newer receipt while an older mailbox lookup finishes", async () => {
    const scenario = await createScenario({
      kind: "mail",
      mailboxId: "one",
      messageId: "old-message",
      threadId: "old-thread",
    });
    const entered = Promise.withResolvers<null>();
    const lookup =
      Promise.withResolvers<
        Awaited<ReturnType<ConsumerOptions["listMailboxes"]>>
      >();
    scenario.listMailboxes.mockImplementationOnce(async () => {
      entered.resolve(null);
      return await lookup.promise;
    });
    const oldAction = scenario.consumer.consume();
    await entered.promise;
    await scenario.inbox.receive({
      kind: "mail",
      mailboxId: "one",
      messageId: "new-message",
      threadId: "new-thread",
    });
    const newAction = scenario.consumer.consume();
    lookup.resolve(scenario.state.mailboxes);
    await Promise.all([oldAction, newAction]);
    expect(scenario.navigations).toHaveLength(1);
    expect(scenario.navigations[0]).toMatchObject({
      messageId: "new-message",
      threadId: "new-thread",
    });
  });

  it("ignores a stopped consumer and permits recovery after a server failure", async () => {
    const scenario = await createScenario({
      kind: "mail",
      mailboxId: "one",
      messageId: "message",
      threadId: "thread",
    });
    scenario.listMailboxes.mockRejectedValueOnce(
      new Error("Network unavailable")
    );
    await scenario.consumer.consume();
    expect(scenario.errors).toHaveLength(1);
    expect(scenario.navigations).toHaveLength(0);
    await scenario.consumer.consume();
    expect(scenario.navigations).toHaveLength(1);
    await scenario.inbox.receive({
      kind: "mailto",
      url: "mailto:new@example.test",
    });
    scenario.consumer.stop();
    await scenario.consumer.consume();
    expect(scenario.navigations).toHaveLength(1);
  });

  it("discards a mailbox lookup completing after the renderer is stopped", async () => {
    const scenario = await createScenario({
      kind: "mail",
      mailboxId: "one",
      messageId: "message",
      threadId: "thread",
    });
    const entered = Promise.withResolvers<null>();
    const lookup =
      Promise.withResolvers<
        Awaited<ReturnType<ConsumerOptions["listMailboxes"]>>
      >();
    scenario.listMailboxes.mockImplementation(async () => {
      entered.resolve(null);
      return await lookup.promise;
    });
    const action = scenario.consumer.consume();
    await entered.promise;
    scenario.consumer.stop();
    lookup.resolve(scenario.state.mailboxes);
    await action;
    expect(scenario.navigations).toHaveLength(0);
    expect(scenario.errors).toHaveLength(0);
  });
});
