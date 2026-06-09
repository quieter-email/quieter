import type { ReactNode } from "react";
import { Button, Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from "@quieter/ui";

export const SettingsRow = ({
  action,
  label,
  value,
}: {
  action: ReactNode;
  label: string;
  value: ReactNode;
}) => (
  <div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 py-5 last:border-b-0 md:flex-row md:items-center">
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 text-sm text-muted-foreground">{value}</div>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);

export const MutedActionButton = ({
  buttonClassName,
  icon,
  label,
  reason,
}: {
  buttonClassName?: string;
  icon: ReactNode;
  label: string;
  reason: string;
}) => (
  <Tooltip>
    <TooltipTrigger
      className="inline-flex focus-visible:outline-none"
      render={<button aria-label={`${label} unavailable`} type="button" />}
    >
      <Button
        className={
          buttonClassName ??
          "pointer-events-none bg-transparent text-muted-foreground opacity-100 hover:bg-transparent hover:text-muted-foreground"
        }
        disabled
        size="sm"
        variant="outline"
      >
        {icon}
        {label}
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      {reason}
      <TooltipArrow />
    </TooltipContent>
  </Tooltip>
);
