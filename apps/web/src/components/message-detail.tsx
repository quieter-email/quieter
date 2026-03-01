import { Show, Suspense } from "solid-js";
import type { MessageListItem } from "~/lib/gmail/gmail";
import { EmptyMessageState } from "./empty-message-state";
import { MessageView } from "./message-view";

type MessageDetailProps = {
  selectedMessage: MessageListItem | null;
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
                Loading conversation...
              </div>
            }
          >
            <MessageView message={msg} />
          </Suspense>
        )}
      </Show>
    </div>
  </section>
);
