export const EmptyMessageState = ({
  description = "Select an email to view.",
  title = "Nothing here yet",
}: {
  description?: string;
  title?: string;
}) => (
  <div className="grid h-full min-h-56 place-items-center">
    <div className="max-w-sm rounded-xl border border-border bg-background-light px-8 py-8 text-center">
      <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
    </div>
  </div>
);
