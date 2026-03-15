"use client";

import type { ButtonHTMLAttributes } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium leading-none outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85",
        outline:
          "border border-input bg-background text-foreground shadow-sm hover:bg-muted/60 active:bg-muted/80",
        ghost:
          "bg-transparent text-foreground-light hover:bg-muted/60 hover:text-foreground active:bg-muted/80",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        default: "h-9 px-4 text-sm",
        lg: "h-10 px-5 text-base",
        "icon-sm": "size-8 p-0 [&_svg]:size-3.5",
        icon: "size-9 p-0 [&_svg]:size-4",
        "icon-lg": "size-10 p-0 [&_svg]:size-4.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, type = "button", variant, ...props }, ref) => (
    <ButtonPrimitive
      ref={ref}
      className={cn(buttonVariants({ size, variant }), className)}
      type={type}
      {...props}
    />
  ),
);

Button.displayName = "Button";
