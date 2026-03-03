import type { ComponentProps } from "solid-js";
import * as ButtonPrimitive from "@kobalte/core/button";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap border text-sm font-medium leading-none outline-none transition-all duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-50 data-disabled:pointer-events-none data-disabled:translate-y-0 data-disabled:scale-100 data-disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-sm hover:border-primary/95 hover:bg-primary/95 hover:shadow-md active:border-primary/90 active:bg-primary/90",
        outline:
          "border-input bg-background text-foreground shadow-sm hover:border-foreground/25 hover:bg-muted/60 hover:shadow-md active:bg-muted/80",
        "outline-light":
          "border-input bg-background-light text-foreground shadow-sm hover:border-foreground/25 hover:bg-background hover:shadow-md active:bg-background-dark",
        "outline-dark":
          "border-foreground/25 bg-background-dark text-foreground shadow-sm hover:border-foreground/25 hover:bg-background hover:shadow-md active:bg-background",
        ghost:
          "border-transparent border hover:border bg-transparent text-muted-foreground hover:border-border/80 hover:bg-muted/60 hover:text-foreground active:bg-muted/80",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground shadow-sm hover:border-destructive/90 hover:bg-destructive/90 hover:shadow-md active:border-destructive/85 active:bg-destructive/85",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-base",
        "icon-sm": "size-8 p-0 [&_svg]:size-3.5",
        icon: "size-10 p-0 [&_svg]:size-4.5",
        "icon-lg": "size-11 p-0 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<typeof ButtonPrimitive.Root> &
  VariantProps<typeof buttonVariants>;

export const Button = (props: ButtonProps) => {
  const [local, others] = splitProps(props, ["class", "variant", "size"]);

  return (
    <ButtonPrimitive.Root
      class={cn(
        buttonVariants({
          variant: local.variant ?? undefined,
          size: local.size ?? undefined,
        }),
        local.class,
      )}
      {...others}
    />
  );
};
