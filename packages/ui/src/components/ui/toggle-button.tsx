import type { ComponentProps } from "solid-js";
import * as ToggleButtonPrimitive from "@kobalte/core/toggle-button";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

const toggleButtonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap border text-sm font-medium leading-none transition-all duration-150 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-50 data-disabled:pointer-events-none data-disabled:translate-y-0 data-disabled:scale-100 data-disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-input bg-background text-foreground shadow-sm hover:border-foreground/25 hover:bg-muted/60 hover:shadow-md data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground data-pressed:border-border data-pressed:bg-muted data-pressed:text-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive/60 hover:bg-destructive/20 data-pressed:border-destructive data-pressed:bg-destructive data-pressed:text-destructive-foreground",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-base",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ToggleButtonProps = ComponentProps<typeof ToggleButtonPrimitive.Root> &
  VariantProps<typeof toggleButtonVariants>;

export const ToggleButton = (props: ToggleButtonProps) => {
  const [local, others] = splitProps(props, ["class", "variant", "size"]);

  return (
    <ToggleButtonPrimitive.Root
      class={cn(
        toggleButtonVariants({
          variant: local.variant ?? undefined,
          size: local.size ?? undefined,
        }),
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};
