export const MessageDetailLoadingSkeleton = () => (
  <div
    aria-live="polite"
    className="mx-auto block w-full max-w-3xl space-y-6 px-4 py-6"
  >
    <span className="sr-only">Loading message…</span>
    <div aria-hidden="true" className="animate-pulse space-y-8">
      <div className="space-y-2">
        <div className="h-5 w-2/3 rounded-md bg-muted/80" />
        <div className="h-3.5 w-44 rounded-md bg-muted/70" />
      </div>

      <div className="flex items-center gap-3 border-t pt-8">
        <div className="size-10 rounded-lg bg-muted/80" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-40 rounded-md bg-muted/80" />
          <div className="h-3 w-56 rounded-md bg-muted/70" />
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <div className="h-3.5 w-full rounded-md bg-muted/70" />
        <div className="h-3.5 w-11/12 rounded-md bg-muted/70" />
        <div className="h-3.5 w-5/6 rounded-md bg-muted/70" />
        <div className="h-3.5 w-2/3 rounded-md bg-muted/70" />
      </div>
    </div>
  </div>
);
