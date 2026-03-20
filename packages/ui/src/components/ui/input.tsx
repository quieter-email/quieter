"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export type InputChrome = "default" | "ghost";
export type InputSize = "sm" | "default" | "lg";
export type InputProps = Omit<ComponentPropsWithoutRef<typeof InputPrimitive>, "size"> & {
  chrome?: InputChrome;
  size?: InputSize;
};

export const Input = forwardRef<HTMLElement, InputProps>(
  ({ chrome = "default", className, size = "default", ...props }, ref) => (
    <InputPrimitive
      ref={ref}
      className={cn(
        "w-full text-foreground transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20",
        chrome === "default" &&
          "rounded-md border border-input bg-background shadow-sm read-only:cursor-default read-only:bg-muted/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
        chrome === "ghost" &&
          "border-0 bg-transparent shadow-none read-only:bg-transparent focus-visible:border-transparent focus-visible:ring-0",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "default" && "h-9 px-3 text-sm",
        size === "lg" && "h-10 px-4 text-base",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
