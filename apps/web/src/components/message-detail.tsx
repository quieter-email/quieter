import { IconLoader } from "@tabler/icons-solidjs";
import { Show, Suspense } from "solid-js";
import type { MessageListItem } from "~/lib/gmail/gmail";
import { EmptyMessageState } from "./empty-message-state";
import { MessageView } from "./message-view";

type MessageDetailProps = {
  selectedMessage: MessageListItem | null;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  isReadStatePending?: boolean;
};

export const MessageDetail = (props: MessageDetailProps) => (
  <section class="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
    <div
      class="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"
      data-message-detail-scroll-container
    >
      <Show when={props.selectedMessage} keyed fallback={<EmptyMessageState />}>
        {(msg) => (
          <Suspense
            fallback={
              <div class="grid h-full place-items-center text-sm text-muted-foreground">
                <IconLoader class="animate-spin text-muted-foreground" />
              </div>
            }
          >
            <MessageView
              message={msg}
              onMarkAsRead={props.onMarkAsRead}
              onMarkAsUnread={props.onMarkAsUnread}
              isReadStatePending={props.isReadStatePending}
            />
          </Suspense>
        )}
      </Show>
    </div>
  </section>
);
