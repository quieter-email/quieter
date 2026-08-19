import { HugeiconsIcon } from "@hugeicons/react";

import { reasoningIcon } from "./message-parts/tools/tool-icons";

export const LoadingDots = () => (
  <span aria-hidden className="inline-flex shrink-0 items-center gap-1.5">
    <span className="chat-loading-dot size-1.5 rounded-full bg-muted-fg/80 [animation-delay:-500ms]" />
    <span className="chat-loading-dot size-1.5 rounded-full bg-muted-fg/80" />
    <span className="chat-loading-dot size-1.5 rounded-full bg-muted-fg/80 [animation-delay:500ms]" />
  </span>
);

/** The turn's first row, before the model has produced anything to show. */
export const ThinkingIndicator = () => (
  <p className="flex items-center gap-2 py-1 text-body/5 text-muted-fg">
    <HugeiconsIcon
      aria-hidden
      className="size-3.5 shrink-0 text-muted-fg/60"
      icon={reasoningIcon}
    />
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">Thinking</span>
      <LoadingDots />
    </span>
  </p>
);
