import { Alert02Icon, ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";

export const ChatError = ({
  disabled,
  message,
  onRetry,
}: {
  disabled?: boolean;
  message: string;
  onRetry?: () => void;
}) => (
  <div className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
    <HugeiconsIcon
      aria-hidden
      className="mt-0.5 size-4 shrink-0 text-destructive"
      icon={Alert02Icon}
    />
    <div className="min-w-0 flex-1">
      <p className="font-medium text-foreground">Response interrupted</p>
      <p className="mt-0.5 text-muted-foreground">{message}</p>
    </div>
    {onRetry ? (
      <Button disabled={disabled} onClick={onRetry} size="sm" type="button" variant="ghost">
        <HugeiconsIcon aria-hidden className="size-3.5" icon={ArrowReloadHorizontalIcon} />
        Retry
      </Button>
    ) : null}
  </div>
);
