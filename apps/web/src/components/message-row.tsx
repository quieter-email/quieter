import type { JSX } from "solid-js";
import { cn } from "@quietr/ui";
import { Show } from "solid-js";
import type { MessageListItem } from "~/lib/gmail/gmail";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { SenderAvatar } from "./sender-avatar";

type MessageRowProps = {
  message: MessageListItem;
  onActivateMessage: (messageId: string) => void;
  class?: string;
  style?: JSX.CSSProperties;
  ref?: (element: HTMLLIElement) => void;
  "data-index"?: number;
};

export const MessageRow = (props: MessageRowProps) => {
  const msg = () => props.message;
  const subject = () => msg().subject || "(No subject)";
  const sender = () => parseSender(msg().from);
  const senderLabel = () => sender().name || sender().email || sender().display;
  const senderEmail = () => (sender().name ? sender().email : "");
  const senderInitial = () => (senderLabel().trim().charAt(0) || "?").toUpperCase();
  const date = () => formatMessageDate(msg(), "compact");

  return (
    <li ref={props.ref} class={props.class} style={props.style} data-index={props["data-index"]}>
      <button
        type="button"
        class={cn(
          "group flex h-16 w-full items-center gap-3 overflow-hidden border border-border bg-background/20 px-3 text-left transition-colors duration-150 hover:border-foreground/25 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:px-3.5",
        )}
        onClick={() => {
          props.onActivateMessage(msg().id);
        }}
        // for now this is just to imperformant
        // onMouseEnter={() => {
        //   void queryClient.prefetchQuery({
        //     ...getThreadWithDetailsOptions(msg().threadId),
        //     staleTime: 30000,
        //   });
        // }}
      >
        <SenderAvatar avatarUrl={msg().senderAvatarUrl} fallbackLabel={senderInitial()} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-baseline justify-between gap-2">
            <p class="min-w-0 flex-1 truncate text-sm text-foreground">
              <span class="font-medium">{senderLabel()}</span>
              <Show when={senderEmail()}>
                <span class="ml-2 text-xs font-light text-muted-foreground">{senderEmail()}</span>
              </Show>
            </p>
            <span class="shrink-0 text-xs text-muted-foreground">{date() || "--"}</span>
          </div>
          <p class="truncate text-sm text-foreground-light">{subject()}</p>
        </div>
      </button>
    </li>
  );
};
