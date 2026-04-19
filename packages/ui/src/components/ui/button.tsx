"use client";

import type { ButtonHTMLAttributes } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { motion, type HTMLMotionProps } from "motion/react";
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
      render={(props) => (
        <motion.button
          initial={{ scale: 1 }}
          whileTap={{
            scale: 0.97,
            transition: {
              duration: 0.1,
            },
          }}
          transition={{ type: "spring", stiffness: 300, damping: 10, mass: 0.75, duration: 0.1 }}
          {...(props as HTMLMotionProps<"button">)}
        />
      )}
      className={cn(
        "squircle inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm leading-none font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        {
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85":
            variant === "default",
          "border border-input bg-background text-foreground shadow-sm hover:bg-input/40 active:bg-input/60":
            variant === "outline",
          "bg-transparent text-foreground-dark hover:bg-secondary/50 hover:text-foreground active:bg-secondary active:text-foreground-light":
            variant === "ghost",
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/85":
            variant === "destructive",
          "h-8 px-3.5 text-[13px] [&_svg]:size-3.5": size === "sm",
          "h-9 px-4 text-sm [&_svg]:size-4": size === "default",
          "h-10 px-5 text-base [&_svg]:size-4.5": size === "lg",
          "size-8 p-0 [&_svg]:size-3.5": size === "icon-sm",
          "size-9 p-0 [&_svg]:size-4": size === "icon",
          "size-10 p-0 [&_svg]:size-4.5": size === "icon-lg",
        },
        className,
      )}
      type={type}
      {...props}
    />
  ),
);

Button.displayName = "Button";
