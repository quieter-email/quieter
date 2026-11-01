"use client";

import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import { useRecentConversations } from "@quieter/app/features/mailbox/components/recent-conversations-provider";
import type { RecentConversation } from "@quieter/app/features/mailbox/domain/recent-conversations";
import type { MessageListProps } from "@quieter/app/features/message-list/components/message-list-types";
import { CopyVerificationCode } from "@quieter/app/features/verification-codes/components/copy-verification-code";
import { useThreadVerificationCodes } from "@quieter/app/features/verification-codes/use-thread-verification-codes";
import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import { Button } from "@quieter/ui/button";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";

export const MailboxIdleState = ({
  mailboxIds,
  onOpen,
  threads,
  scope,
}: {
  mailboxIds: readonly string[];
  onOpen: (entry: RecentConversation) => void;
  threads: Pick<ThreadListEntry, "threadId">[];
  scope: Pick<
    MessageListProps,
    | "activeMailbox"
    | "mailboxId"
    | "mailboxProvider"
    | "mailboxContextsByThreadId"
  >;
}) => {
  const activity = useRecentConversations();
  const recents = activity.entries
    .filter((entry) => mailboxIds.includes(entry.mailboxId))
    .slice(0, 3);
  const codesByThread = useThreadVerificationCodes(threads, scope);
  const codes = threads
    .flatMap(({ threadId }) => {
      const code = codesByThread.get(threadId);
      return code ? [{ code, threadId }] : [];
    })
    .slice(0, 2);
  return (
    <EmptyMessageState
      action={
        recents.length > 0 || codes.length > 0 ? (
          <div className="w-80 max-w-full">
            <Surface>
              <div className="flex flex-col gap-4 text-left">
                {recents.length > 0 ? (
                  <section className="flex min-w-0 flex-col gap-2.5">
                    <Text as="h2" size="caption" tone="muted" weight="medium">
                      Recently opened
                    </Text>
                    <div className="flex min-w-0 flex-col gap-2.5">
                      {recents.map((entry) => {
                        const sender = parseSender(entry.message.from);
                        return (
                          <Button
                            className="w-full min-w-0"
                            key={JSON.stringify([
                              entry.mailboxId,
                              entry.message.threadId,
                            ])}
                            onClick={() => {
                              onOpen(entry);
                            }}
                            size="auto"
                            variant="secondary"
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <Text
                                as="span"
                                size="sm"
                                weight="normal"
                                truncate
                              >
                                {entry.message.subject}
                              </Text>
                              <Text
                                as="span"
                                size="caption"
                                tone="muted"
                                weight="normal"
                                truncate
                              >
                                {sender.name || sender.email}
                              </Text>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {codes.length > 0 ? (
                  <section className="flex min-w-0 flex-col gap-2.5">
                    <Text as="h2" size="caption" tone="muted" weight="medium">
                      Verification codes
                    </Text>
                    <div className="flex flex-col gap-2.5">
                      {codes.map(({ threadId, code }) => (
                        <div
                          className="flex min-w-0 items-center justify-between gap-3"
                          key={threadId}
                        >
                          <Text size="sm" truncate>
                            {code.service || "Verification code"}
                          </Text>
                          <CopyVerificationCode code={code.code} size="xs" />
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </Surface>
          </div>
        ) : undefined
      }
    />
  );
};
