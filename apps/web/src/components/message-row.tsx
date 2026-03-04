import type { JSX } from "solid-js";
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@quietr/ui";
import { Show } from "solid-js";
import { isMessageUnread, type MessageListItem } from "~/lib/gmail/gmail";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { SenderAvatar } from "./sender-avatar";

type MessageRowProps = {
  message: MessageListItem;
  isActive?: boolean;
  onActivateMessage: (messageId: string) => void;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  isReadStatePending?: boolean;
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
  const isActive = () => Boolean(props.isActive);
  const isUnread = () => isMessageUnread(msg());
  const isReadStatePending = () => Boolean(props.isReadStatePending);
  const canToggleReadState = () =>
    !isReadStatePending() &&
    (isUnread() ? Boolean(props.onMarkAsRead) : Boolean(props.onMarkAsUnread));

  return (
    <li ref={props.ref} class={props.class} style={props.style} data-index={props["data-index"]}>
      <ContextMenu>
        <ContextMenuTrigger
          as="button"
          aria-current={isActive() ? "true" : undefined}
          class={cn(
            "group relative flex h-16 w-full items-center gap-3 overflow-hidden rounded-lg border border-border/90 bg-background px-3 text-left transition-all duration-150 hover:-translate-y-px hover:border-foreground/25 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:px-3.5",
            isActive() &&
              "border-foreground/55 bg-muted/70 shadow-[0_10px_22px_-14px_rgba(15,23,42,0.46)]",
            isUnread() && !isActive() && "border-foreground/45 bg-muted/35",
          )}
          onClick={() => {
            props.onActivateMessage(msg().id);
          }}
        >
          <SenderAvatar avatarUrl={msg().senderAvatarUrl} fallbackLabel={senderInitial()} />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex min-w-0 items-baseline justify-between gap-2">
              <p class="min-w-0 flex-1 truncate text-sm text-foreground">
                <span class={cn(isUnread() ? "font-semibold" : "font-medium")}>
                  {senderLabel()}
                </span>
                <Show when={senderEmail()}>
                  <span class="ml-2 text-xs font-light text-muted-foreground">{senderEmail()}</span>
                </Show>
              </p>
              <span
                class={cn(
                  "shrink-0 text-xs",
                  isUnread() ? "font-semibold text-foreground/90" : "text-muted-foreground",
                  isActive() && !isUnread() && "text-foreground/75",
                )}
              >
                {date() || "--"}
              </span>
            </div>
            <p
              class={cn(
                "truncate text-sm",
                isUnread() ? "font-medium text-foreground" : "text-foreground-light",
              )}
            >
              {subject()}
            </p>
          </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuGroup>
              <ContextMenuGroupLabel>Destructive Actions</ContextMenuGroupLabel>
              <ContextMenuItem>
                <ContextMenuItemLabel>Delete</ContextMenuItemLabel>
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuGroupLabel>Other Actions</ContextMenuGroupLabel>
              <ContextMenuItem
                disabled={!canToggleReadState()}
                onSelect={() => {
                  if (isReadStatePending()) return;

                  if (isUnread()) {
                    void props.onMarkAsRead?.(msg().id);
                    return;
                  }

                  void props.onMarkAsUnread?.(msg().id);
                }}
              >
                <ContextMenuItemLabel>
                  {isUnread() ? "Mark as Read" : "Mark as Unread"}
                </ContextMenuItemLabel>
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    </li>
  );
};
