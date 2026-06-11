export const ThinkingIndicator = () => (
  <p className="min-h-5 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex gap-0.5">
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </span>
      <span>Thinking</span>
    </span>
  </p>
);
