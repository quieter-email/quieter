import type { ReactNode } from "react";
import { Button } from "@quieter/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import { SettingsFieldRow } from "../settings-layout";

export { SettingsFieldRow as SettingsRow };

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
    <TooltipContent>{reason}</TooltipContent>
  </Tooltip>
);
