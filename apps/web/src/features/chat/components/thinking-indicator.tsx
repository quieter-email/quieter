export const LoadingDots = () => (
  <span aria-hidden className="inline-flex shrink-0 items-center gap-1">
    <span className="chat-loading-dot size-1 rounded-full bg-muted-foreground [animation-delay:-240ms]" />
    <span className="chat-loading-dot size-1 rounded-full bg-muted-foreground [animation-delay:-120ms]" />
    <span className="chat-loading-dot size-1 rounded-full bg-muted-foreground" />
  </span>
);

export const ThinkingIndicator = () => (
  <p className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
    <LoadingDots />
    <span>Thinking</span>
  </p>
);
