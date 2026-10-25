import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const workspaceGutterClassName =
  "[--workspace-gutter:0px] lg:[--workspace-gutter:var(--workspace-gap-wide)]";

export const workspaceSectionVariants = cva(
  `${workspaceGutterClassName} overflow-hidden rounded-none border-0 bg-bg-raised shadow-none [background-image:var(--panel-gradient)] lg:rounded-xl lg:border lg:border-border lg:shadow-surface`,
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

/**
 * Shared mailbox workspace panel chrome: inset/margins, rounded border, muted surface.
 * Use `workspaceSectionVariants` when the host must be a `form`, motion node, or other element.
 */
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
