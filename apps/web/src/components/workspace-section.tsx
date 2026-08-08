import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@quieter/ui/cn";
import { cva, type VariantProps } from "class-variance-authority";

export const workspaceSectionVariants = cva(
  "overflow-hidden rounded-lg border border-border bg-bg/60",
  {
    variants: {
      layout: {
        fill: "absolute inset-1.5 flex min-h-0 min-w-0 flex-col",
        cell: "m-1.5 min-h-0 min-w-0 flex-1 flex-col lg:m-2 lg:ml-0 lg:flex",
      },
      centered: {
        true: "items-center justify-center",
        false: null,
      },
    },
    defaultVariants: {
      layout: "fill",
      centered: false,
    },
  },
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
  <section {...props} className={cn(workspaceSectionVariants({ centered, layout }), className)} />
);
