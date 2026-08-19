import { HugeiconsIcon } from "@hugeicons/react";

import { reasoningIcon } from "./message-parts/tools/tool-icons";

export const LoadingDots = () => (
  <span aria-hidden className="inline-flex shrink-0 items-center gap-1">
    <span className="chat-loading-dot size-1 rounded-full bg-muted-fg [animation-delay:-240ms]" />
    <span className="chat-loading-dot size-1 rounded-full bg-muted-fg [animation-delay:-120ms]" />
    <span className="chat-loading-dot size-1 rounded-full bg-muted-fg" />
  </span>
);

/** The turn's first row, before the model has produced anything to show. */
export const ThinkingIndicator = () => (
  <p className="flex items-center gap-2.5 py-1 text-body/5 text-muted-fg">
    <HugeiconsIcon
      aria-hidden
      className="size-3.5 shrink-0 text-muted-fg/60"
      icon={reasoningIcon}
    />
    <span className="min-w-0 flex-1">Thinking</span>
    <LoadingDots />
  </p>
);
