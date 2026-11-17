import type { MailboxCategory } from "@quieter/app/lib/mail";
import type { SessionUser } from "@quieter/app/session-user";
import type { RouterOutputs } from "@quieter/orpc";

import type { DesktopBridge } from "../shared/bridge";
import type { NativeMailTarget } from "../shared/native-links";

type ListedMailbox =
  RouterOutputs["mail"]["listMailboxes"]["groups"][number]["mailboxes"][number];
type NativeMailbox = Pick<ListedMailbox, "id"> & {
  capabilities: Pick<ListedMailbox["capabilities"], "categories">;
};

export type NativeMailNavigation =
  | Extract<NativeMailTarget, { kind: "mailto" }>
  | (Extract<NativeMailTarget, { kind: "mail" }> & {
      mailbox: MailboxCategory;
    });

type NativeLinkConsumerOptions = {
  userId: string;
  nativeLinks: Pick<DesktopBridge["nativeLinks"], "read">;
  readUser: (
    signal: AbortSignal
  ) => Promise<Pick<SessionUser, "id" | "needsOnboarding"> | null>;
  listMailboxes: (
    signal: AbortSignal
  ) => Promise<{ groups: { mailboxes: NativeMailbox[] }[] }>;
  navigate: (target: NativeMailNavigation) => Promise<void>;
  onError: (error: unknown) => void;
};

export class NativeLinkConsumer {
  private readonly controller = new AbortController();
  private previous: Promise<null> = Promise.resolve(null);
  private readonly options: NativeLinkConsumerOptions;

  constructor(options: NativeLinkConsumerOptions) {
    this.options = options;
  }

  async consume(): Promise<void> {
    const { previous } = this;
    const completion = Promise.withResolvers<null>();
    this.previous = completion.promise;
    try {
      await previous;
      if (!this.controller.signal.aborted) {
        await this.openPending(this.controller.signal);
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.options.onError(error);
      }
    } finally {
      completion.resolve(null);
    }
  }

  stop(): void {
    this.controller.abort();
  }

  private async openPending(signal: AbortSignal): Promise<void> {
    const { nativeLinks, userId } = this.options;
    const intent = await nativeLinks.read({ kind: "peek", userId });
    if (signal.aborted || !intent) {
      return;
    }
    const user = await this.options.readUser(signal);
    if (signal.aborted || user?.id !== userId || user.needsOnboarding) {
      return;
    }
    let navigation: NativeMailNavigation;
    if (intent.target.kind === "mailto") {
      navigation = intent.target;
    } else {
      const { target } = intent;
      const mailboxes = await this.options.listMailboxes(signal);
      if (signal.aborted) {
        return;
      }
      const mailbox = mailboxes.groups
        .flatMap((group) => group.mailboxes)
        .find((candidate) => candidate.id === target.mailboxId);
      let category: MailboxCategory | undefined;
      if (mailbox?.capabilities.categories.includes("inbox") === true) {
        category = "inbox";
      } else if (mailbox?.capabilities.categories.includes("sent") === true) {
        category = "sent";
      }
      if (!category) {
        throw Object.assign(
          new Error("This email link is not available for your account."),
          { status: 403 }
        );
      }
      navigation = { ...target, mailbox: category };
    }
    const consumed = await nativeLinks.read({
      id: intent.id,
      kind: "take",
      userId,
    });
    if (signal.aborted || !consumed) {
      return;
    }
    await this.options.navigate(navigation);
  }
}
