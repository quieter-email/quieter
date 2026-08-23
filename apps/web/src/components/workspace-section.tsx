import { cn } from "@quieter/ui/cn";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

export const workspaceSectionVariants = cva(
  "overflow-hidden rounded-lg border border-border bg-bg-raised/60",
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
        cell: "m-1.5 min-h-0 min-w-0 flex-1 flex-col lg:m-2 lg:ml-0 lg:flex",
        fill: "absolute inset-1.5 flex min-h-0 min-w-0 flex-col",
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
