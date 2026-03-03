import { IconLoader } from "@tabler/icons-solidjs";
import { useQuery } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { type MessageListItem } from "~/lib/gmail/gmail";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { MessageBody } from "./message-body";
import { SenderAvatar } from "./sender-avatar";

type MessageViewProps = {
  message: MessageListItem;
};

export const MessageView = (props: MessageViewProps) => {
  const selectedMessage = () => props.message;

  const threadQuery = useQuery(() => getThreadWithDetailsOptions(selectedMessage().threadId));

  const messages = createMemo<MessageListItem[]>(() => {
    const threadMessages = threadQuery.data?.messages;
    if (threadMessages?.length) {
      return [...threadMessages].reverse();
    }
    return [selectedMessage()];
  });

  const subject = createMemo(
    () => threadQuery.data?.subject || selectedMessage().subject || "(No subject)",
  );

  const [expandedMessageId, setExpandedMessageId] = createSignal<string | null>(null);

  createEffect(() => {
    const orderedMessages = messages();
    const newestMessageId = orderedMessages[0]?.id ?? null;

    if (!newestMessageId) {
      setExpandedMessageId(null);
      return;
    }

    const currentExpanded = expandedMessageId();
    const hasExpandedMessage =
      currentExpanded !== null && orderedMessages.some((message) => message.id === currentExpanded);

    if (!hasExpandedMessage) {
      setExpandedMessageId(newestMessageId);
    }
  });

  const toggleExpandedMessage = (messageId: string) => {
    setExpandedMessageId((current) => (current === messageId ? null : messageId));
  };

  return (
    <article class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header class="mb-6 border-b border-border/50 pb-4 sm:mb-4">
        <h1 class="text-xl leading-tight font-medium tracking-tight text-foreground-dark sm:text-2xl">
          {subject()}
        </h1>
        <p class="mt-2 text-sm text-muted-foreground">
          {messages().length} {messages().length === 1 ? "message" : "messages"}
        </p>

        <Show when={threadQuery.isPending && !threadQuery.data}>
          <IconLoader class="mt-2 animate-spin text-muted-foreground" />
        </Show>

        <Show when={threadQuery.isError}>
          <p class="mt-2 text-sm text-destructive">
            Could not load the full thread. Showing the selected email only.
          </p>
        </Show>
      </header>

      <div class="flex flex-col">
        <For each={messages()}>
          {(message) => {
            const sender = parseSender(message.from);
            const senderName = sender.name || sender.display || "Unknown sender";
            const senderEmail = sender.email || "";
            const senderInitial = (senderName.trim().charAt(0) || "?").toUpperCase();
            const date = formatMessageDate(message, "full") || "--";
            const preview = message.snippet?.trim();

            return (
              <section class="border-b border-border/40 py-4 sm:py-6">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-start gap-4 text-left transition-opacity outline-none hover:opacity-80"
                  aria-expanded={expandedMessageId() === message.id}
                  onClick={() => {
                    toggleExpandedMessage(message.id);
                  }}
                >
                  <div class="mt-0.5 shrink-0">
                    <SenderAvatar
                      avatarUrl={message.senderAvatarUrl}
                      fallbackLabel={senderInitial}
                    />
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span class="truncate text-sm font-semibold text-foreground-dark sm:text-base">
                        {senderName}
                      </span>
                      <Show when={senderEmail} keyed>
                        {(email) => (
                          <span class="truncate font-mono text-xs text-muted-foreground sm:text-sm">
                            {email}
                          </span>
                        )}
                      </Show>
                    </div>

                    <Show when={preview} keyed>
                      {(snippet) => (
                        <p class="mt-1 truncate text-sm text-foreground-light">{snippet}</p>
                      )}
                    </Show>
                  </div>

                  <div class="ml-2 flex shrink-0 items-center gap-3">
                    <span class="text-xs text-muted-foreground sm:text-sm">{date}</span>
                  </div>
                </button>

                <Show when={expandedMessageId() === message.id}>
                  <div class="pt-3 pl-12">
                    <MessageBody
                      html={message.bodyHtml}
                      text={message.bodyText}
                      snippet={message.snippet}
                      compact
                    />
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
      </div>
    </article>
  );
};
