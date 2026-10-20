import { Button } from "@quieter/ui/button";
import type { ButtonProps } from "@quieter/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import type { ReactNode } from "react";

export { SettingsFieldRow as SettingsRow } from "../settings-layout";

export const MutedActionButton = ({
  icon,
  label,
  reason,
  variant = "outline",
}: {
  icon: ReactNode;
  label: string;
  reason: string;
  variant?: ButtonProps["variant"];
}) => (
  <Tooltip>
    <TooltipTrigger
      className="inline-flex"
      render={
        <span
          aria-disabled="true"
          aria-label={`${label} unavailable: ${reason}`}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Tooltip needs a focusable wrapper around a disabled Button without nesting buttons.
          role="button"
          tabIndex={0}
        />
      }
    >
      <Button aria-hidden disabled size="sm" tabIndex={-1} variant={variant}>
        {icon}
        {label}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{reason}</TooltipContent>
  </Tooltip>
);
