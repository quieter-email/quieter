import type { parseMailReference } from "@quieter/app/features/chat/domain/mail-reference";
import { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { toastError } from "@quieter/app/lib/error-toast";
import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import { getCachedMessagesQueries } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import { Button } from "@quieter/ui/button";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import { Text } from "@quieter/ui/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

export const MailReference = ({
  children,
  inline = false,
  reference,
}: {
  children: ReactNode;
  inline?: boolean;
  reference: NonNullable<ReturnType<typeof parseMailReference>>;
}) => {
  const setMailboxSearch = useMailboxSearchActions();
  const workspace = useAgentWorkspace();
  const queryClient = useQueryClient();
  const cachedMessage = getCachedMessagesQueries(
    queryClient,
    workspace?.mailboxId ?? ""
  )
    .flatMap(
      (query) => query.data?.pages.flatMap((page) => page.messages) ?? []
    )
    .find((message) => message.id === reference.messageId);
  const threadId = cachedMessage?.threadId ?? reference.threadId;
  const { data: thread } = useQuery(
    getThreadWithDetailsOptions(
      workspace?.mailboxId ?? "",
      threadId ?? "",
      !!workspace &&
        !!threadId &&
        (inline
          ? !cachedMessage?.subject && !reference.subject
          : !cachedMessage?.senderAvatarUrls)
    )
  );
  const message =
    thread?.messages.find((item) => item.id === reference.messageId) ??
    cachedMessage;
  const sender = parseSender(message?.from ?? reference.from);
  const senderLabel = sender.name || sender.email || sender.display;
  const subjectLabel = message
    ? message.subject?.trim() || "Untitled mail"
    : reference.subject;
  const subject = subjectLabel || (children ?? "Open email");
  const openMessage = async () => {
    workspace?.control.cancel();
    try {
      await setMailboxSearch(
        {
          mailbox: "inbox",
          messageId: reference.messageId,
          query: null,
          threadId: threadId ?? null,
          view: "inbox",
          workspace: null,
        },
        { replace: false }
      );
    } catch (error) {
      toastError(error, {
        boundary: "assistant-mail-reference",
        fallback: "Could not open this email. Try again.",
      });
    }
  };

  return (
    <Button
      className="max-w-full align-middle"
      onClick={() => {
        void openMessage();
      }}
      size={inline ? "text" : "auto"}
      title={
        senderLabel
          ? `${subjectLabel ?? "Email"}, ${senderLabel}`
          : subjectLabel
      }
      type="button"
      variant={inline ? "link" : "outline"}
    >
      {inline ? null : (
        <SenderAvatar
          avatarUrlDark={message?.senderAvatarUrls?.dark}
          avatarUrlLight={message?.senderAvatarUrls?.light}
          fallbackLabel={(senderLabel.trim().charAt(0) || "?").toUpperCase()}
        />
      )}
      <span className="flex min-w-0 flex-col">
        <Text as="span" size="sm" tone={inline ? "muted" : "default"} truncate>
          {subject}
        </Text>
        {!inline && senderLabel ? (
          <span className="truncate text-caption text-muted-fg">
            {senderLabel}
          </span>
        ) : null}
      </span>
    </Button>
  );
};
