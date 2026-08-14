import { Button } from "@quieter/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import type { ReactNode } from "react";

export { SettingsFieldRow as SettingsRow } from "../settings-layout";

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
      className="inline-flex"
      render={<button aria-label={`${label} unavailable`} type="button" />}
    >
      <Button
        className={
          buttonClassName ??
          "pointer-events-none bg-transparent text-muted-fg opacity-100 hover:bg-transparent hover:text-muted-fg"
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
