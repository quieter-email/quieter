"use client";

import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import { messageListHeaderControlVariants } from "./message-list-header-surfaces";

/**
 * Owns the message list header row: a sidebar slot that survives every state,
 * plus a single stacked cell that cross-fades between search and selection so
 * the row keeps its height and the controls around it never move.
 */
export const MessageListHeader = ({
  onOpenSidebar,
  search,
  selection,
}: {
  onOpenSidebar?: () => void;
  search: ReactNode;
  selection: ReactNode | null;
}) => {
  const reducedMotion = useReducedMotion();
  const presence = getAppPresenceMotion({ reducedMotion });
  const rowMotion = {
    ...presence,
    exit: { ...presence.exit, pointerEvents: "none" as const },
  };

  return (
    <div className="bg-transparent p-2 @sm:px-4 @sm:pt-4 @sm:pb-3">
      <div className="flex min-w-0 items-stretch gap-2">
        {onOpenSidebar && (
          <div className="flex self-stretch lg:hidden">
            <IconButtonTooltip label="Open sidebar">
              <Button
                aria-label="Open sidebar"
                className={messageListHeaderControlVariants({
                  control: "toolbar",
                })}
                onClick={onOpenSidebar}
                size="icon"
                variant="ghost"
              >
                <HugeiconsIcon icon={SidebarLeftIcon} />
              </Button>
            </IconButtonTooltip>
          </div>
        )}

        <div className="grid min-w-0 flex-1 grid-cols-1 grid-rows-1">
          <LazyMotion features={domAnimation}>
            <AnimatePresence initial={false}>
              {selection === null ? (
                <m.div
                  className="col-start-1 row-start-1 min-w-0"
                  key="search"
                  {...rowMotion}
                >
                  {search}
                </m.div>
              ) : (
                <m.div
                  className="col-start-1 row-start-1 min-w-0"
                  key="selection"
                  {...rowMotion}
                >
                  {selection}
                </m.div>
              )}
            </AnimatePresence>
          </LazyMotion>
        </div>
      </div>
    </div>
  );
};
