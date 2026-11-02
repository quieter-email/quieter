import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const workspaceGutterClassName =
  "[--workspace-gutter:0px] lg:[--workspace-gutter:var(--workspace-gap-wide)]";

export const workspaceSectionVariants = cva(
  `${workspaceGutterClassName} overflow-hidden rounded-none border-0 bg-panel shadow-none [background-image:var(--panel-gradient)] lg:rounded-panel lg:border lg:border-transparent`,
  {
    defaultVariants: {
      centered: false,
      layout: "fill",
    },
    variants: {
      centered: {
        false: null,
        true: "items-center justify-center",
      },
      layout: {
        cell: "m-(--workspace-gutter) min-h-0 min-w-0 flex-1 flex-col lg:ml-0 lg:flex",
        fill: "absolute inset-(--workspace-gutter) flex min-h-0 min-w-0 flex-col",
        surface: "flex min-h-0 min-w-0 flex-col",
      },
    },
  }
);

export type WorkspaceSectionProps = ComponentPropsWithoutRef<"section"> &
  VariantProps<typeof workspaceSectionVariants>;

export const WorkspaceSection = ({
  centered = false,
  className,
  layout = "fill",
  ...props
}: WorkspaceSectionProps) => (
  <section
    {...props}
    className={cn(workspaceSectionVariants({ centered, layout }), className)}
  />
);

export const workspaceHeaderVariants = cva(
  "relative m-0.5 shrink-0 rounded-section bg-section p-3.5"
);

export type WorkspaceHeaderProps = ComponentPropsWithoutRef<"header">;

export const WorkspaceHeader = ({
  className,
  ...props
}: WorkspaceHeaderProps) => (
  <header {...props} className={cn(workspaceHeaderVariants(), className)} />
);
