"use client";

import type { ButtonHTMLAttributes } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "default" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "default" | "lg" | "icon-sm" | "icon" | "icon-lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "default", type = "button", variant = "default", ...props }, ref) => (
    <ButtonPrimitive
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm leading-none font-medium whitespace-nowrap transition-colors duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "default" &&
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85",
        variant === "outline" &&
          "border border-input bg-background text-foreground shadow-sm hover:bg-muted/60 active:bg-muted/80",
        variant === "ghost" &&
          "bg-transparent text-foreground-light hover:bg-muted/60 hover:text-foreground active:bg-muted/80",
        variant === "destructive" &&
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
        size === "sm" && "h-8 px-3.5 text-[13px] [&_svg]:size-3.5",
        size === "default" && "h-9 px-4 text-sm [&_svg]:size-4",
        size === "lg" && "h-10 px-5 text-base [&_svg]:size-4.5",
        size === "icon-sm" && "size-8 p-0 [&_svg]:size-3.5",
        size === "icon" && "size-9 p-0 [&_svg]:size-4",
        size === "icon-lg" && "size-10 p-0 [&_svg]:size-4.5",
        className,
      )}
      type={type}
      {...props}
    />
  ),
);

Button.displayName = "Button";
