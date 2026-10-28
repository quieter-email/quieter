import type { ReactElement, ReactNode } from "react";

import { cn } from "../../lib/cn";

type WorkspaceDockProps = {
  children: ReactNode;
  contentInert?: boolean;
  open: boolean;
  sidebar: ReactElement | null;
};

export const WorkspaceDock = ({
  children,
  contentInert = false,
  open,
  sidebar,
}: WorkspaceDockProps) => {
  const expanded = open && sidebar !== null;

  return (
    // oxlint-disable-next-line shadcn/no-arbitrary-values -- The dock follows the available viewport while keeping one shared sidebar width.
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden [--workspace-dock-width:clamp(20rem,26vw,25rem)]">
      <div
        aria-hidden={expanded && contentInert}
        className={cn(
          "relative isolate flex min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden bg-transparent transition-none duration-(--app-motion-duration-layout) ease-(--app-motion-ease-out) motion-reduce:transition-none xl:transition-[width]",
          {
            "xl:w-[calc(100%-var(--workspace-dock-width))]": expanded,
          }
        )}
        data-workspace-dock-main
        inert={expanded && contentInert}
      >
        {children}
      </div>
      {sidebar === null ? null : (
        <div
          aria-hidden={!expanded}
          className={cn(
            "absolute inset-y-0 right-0 z-20 w-full transition-[translate,opacity] duration-(--app-motion-duration-layout) ease-(--app-motion-ease-out) motion-reduce:translate-x-0 motion-reduce:transition-opacity xl:w-(--workspace-dock-width)",
            {
              "pointer-events-none invisible translate-x-full opacity-0 transition-[translate,opacity,visibility]":
                !expanded,
              "visible translate-x-0 opacity-100": expanded,
            }
          )}
          data-workspace-dock-sidebar
          inert={!expanded}
        >
          {sidebar}
        </div>
      )}
    </div>
  );
};
