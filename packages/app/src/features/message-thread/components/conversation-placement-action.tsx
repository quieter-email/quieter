"use client";

import { AlarmClockIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { useRef, useState } from "react";

type ConversationPlacementActionProps = {
  disabled: boolean;
  icon: IconSvgElement;
  label: string;
  onToggle: () => void;
  /** Offered beside Done after a hover delay, or with ArrowDown. */
  snooze?: { label: string; onOpen: () => void };
};

export const ConversationPlacementAction = ({
  disabled,
  icon,
  label,
  onToggle,
  snooze,
}: ConversationPlacementActionProps) => {
  const [open, setOpen] = useState(false);
  const snoozeButtonRef = useRef<HTMLButtonElement>(null);
  const keyboardFocusRef = useRef(false);

  if (snooze === undefined) {
    return (
      <IconButtonTooltip label={label}>
        <Button
          aria-label={label}
          chrome="toolbar"
          disabled={disabled}
          onClick={onToggle}
          size="icon-sm"
          variant="ghost"
        >
          <Icon aria-hidden icon={icon} />
        </Button>
      </IconButtonTooltip>
    );
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          keyboardFocusRef.current = false;
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <PopoverTrigger
        aria-keyshortcuts="ArrowDown"
        aria-label={label}
        closeDelay={150}
        delay={500}
        disabled={disabled}
        onClick={(event) => {
          // The trigger's primary action is Done.
          event.preventBaseUIHandler();
          keyboardFocusRef.current = false;
          setOpen(false);
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") {
            return;
          }
          event.preventDefault();
          keyboardFocusRef.current = true;
          if (open) {
            snoozeButtonRef.current?.focus();
          } else {
            setOpen(true);
          }
        }}
        openOnHover
        render={<Button chrome="toolbar" size="icon-sm" variant="ghost" />}
      >
        <Icon aria-hidden icon={icon} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        finalFocus={() => keyboardFocusRef.current}
        initialFocus={() =>
          keyboardFocusRef.current ? snoozeButtonRef.current : false
        }
        size="compact"
      >
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <span aria-hidden className="ps-2 text-caption text-muted-fg">
          {label}
        </span>
        <Button
          onClick={() => {
            keyboardFocusRef.current = false;
            setOpen(false);
            snooze.onOpen();
          }}
          ref={snoozeButtonRef}
          size="xs"
          variant="secondary"
        >
          <Icon aria-hidden icon={AlarmClockIcon} />
          {snooze.label}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
