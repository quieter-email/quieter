import type { ComponentProps } from "solid-js";
import * as BadgePrimitive from "@kobalte/core/badge";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex select-none items-center justify-center gap-1 border px-2 py-0.5 text-xs font-medium tracking-wide uppercase",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border bg-background text-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/35 bg-warning/20 text-warning-foreground",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      },
      size: {
        sm: "px-1.5 py-0 text-[10px]",
        default: "px-2 py-0.5 text-xs",
        lg: "px-2.5 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type BadgeProps = ComponentProps<typeof BadgePrimitive.Root> &
  VariantProps<typeof badgeVariants>;

export const Badge = (props: BadgeProps) => {
  const [local, others] = splitProps(props, ["class", "variant", "size"]);

  return (
    <BadgePrimitive.Root
      class={cn(
        badgeVariants({
          variant: local.variant ?? undefined,
          size: local.size ?? undefined,
        }),
        local.class,
      )}
      {...others}
    />
  );
};
