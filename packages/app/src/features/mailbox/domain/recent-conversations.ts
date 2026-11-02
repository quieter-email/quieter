import type { MessageListItem } from "@quieter/app/lib/mail";
import { createStore } from "@tanstack/react-store";

export type RecentConversation = {
  mailboxId: string;
  message: Pick<MessageListItem, "id" | "threadId" | "subject" | "from">;
};

export const createRecentConversations = () => {
  const state = createStore<{
    phase: "active" | "revoked";
    mailboxIds: ReadonlySet<string>;
    quarantined: ReadonlySet<string>;
    entries: RecentConversation[];
  }>({
    entries: [],
    mailboxIds: new Set<string>(),
    phase: "active",
    quarantined: new Set<string>(),
  });
  return {
    authorize(mailboxIds?: ReadonlySet<string>) {
      state.setState((current) =>
        current.phase === "revoked"
          ? current
          : {
              ...current,
              entries: mailboxIds
                ? current.entries.filter((entry) =>
                    mailboxIds.has(entry.mailboxId)
                  )
                : current.entries,
              mailboxIds: mailboxIds ?? new Set<string>(),
            }
      );
    },
    loseAccess({
      mailboxId,
      threadId,
    }: {
      mailboxId: string;
      threadId?: string;
    }) {
      state.setState((current) => ({
        ...current,
        entries: current.entries.filter(
          (entry) =>
            entry.mailboxId !== mailboxId ||
            (threadId !== undefined && entry.message.threadId !== threadId)
        ),
        quarantined:
          threadId === undefined
            ? new Set([...current.quarantined, mailboxId])
            : current.quarantined,
      }));
    },
    recordOpened: ({
      mailboxId,
      message,
    }: {
      mailboxId: string;
      message: MessageListItem;
    }) => {
      state.setState((current) => {
        if (
          current.phase === "revoked" ||
          !current.mailboxIds.has(mailboxId) ||
          current.quarantined.has(mailboxId)
        ) {
          return current;
        }
        const snapshot: RecentConversation = {
          mailboxId,
          message: {
            from: message.from,
            id: message.id,
            subject: message.subject,
            threadId: message.threadId,
          },
        };
        let mailboxCount = 0;
        return {
          ...current,
          entries: [
            snapshot,
            ...current.entries.filter(
              (entry) =>
                entry.mailboxId !== mailboxId ||
                entry.message.threadId !== message.threadId
            ),
          ].filter((entry) => {
            if (entry.mailboxId !== mailboxId) {
              return true;
            }
            mailboxCount += 1;
            return mailboxCount <= 3;
          }),
        };
      });
    },
    revoke() {
      state.setState((current) => ({
        ...current,
        entries: [],
        mailboxIds: new Set<string>(),
        phase: "revoked",
        quarantined: new Set<string>(),
      }));
    },
    state,
  };
};
