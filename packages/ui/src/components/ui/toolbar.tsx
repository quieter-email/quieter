"use client";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { inputControlClassName } from "./input-chrome";
import { surfaceVariants } from "./surface";

const ToolbarChromeContext = createContext<"default" | "inset">("default");

export const Toolbar = ({
  chrome = "default",
  className,
  size = "default",
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root> & {
  chrome?: "default" | "inset";
  size?: "default" | "compact";
}) => (
  <ToolbarChromeContext value={chrome}>
    <ToolbarPrimitive.Root
      className={cn(
        surfaceVariants({
          chrome: chrome === "inset" ? "inset" : "default",
          padding: "none",
          variant: chrome === "inset" ? "detail" : "section",
        }),
        "inline-flex items-center border border-transparent shadow-sm squircle",
        {
          "m-0.5 min-h-12 gap-1.5 border-0 px-3.5 py-2 shadow-none":
            chrome === "inset",
          "min-h-10 gap-1 p-1": chrome === "default" && size === "default",
          "min-h-8 gap-0.5 rounded-lg p-0.5":
            chrome === "default" && size === "compact",
        },
        className
      )}
      {...props}
    />
  </ToolbarChromeContext>
);

export const ToolbarGroup = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Group>) => (
  <ToolbarPrimitive.Group
    className={cn("inline-flex items-center gap-1", className)}
    {...props}
  />
);

const toolbarButtonVariants = cva(
  "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-transparent px-3.5 text-body-sm font-medium whitespace-nowrap text-muted-fg transition-[background-color,color,scale] duration-150 ease-out select-none hover:bg-muted hover:text-fg focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.97] active:bg-control-active active:text-fg disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    compoundVariants: [
      {
        chrome: "inset",
        className: "hover:bg-control-hover",
        variant: "default",
      },
      {
        chrome: "inset",
        className: "bg-accent hover:bg-control-active",
        variant: "selected",
      },
    ],
    defaultVariants: {
      chrome: "default",
      size: "default",
      variant: "default",
    },
    variants: {
      chrome: { default: null, inset: null },
      size: {
        default: "",
        icon: "size-8 p-0",
        "icon-sm": "size-7 p-0",
      },
      variant: {
        default: "",
        primary:
          "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover hover:text-primary-fg active:bg-primary-active active:text-primary-fg",
        selected: "bg-selection text-fg shadow-sm",
      },
    },
  }
);

type ToolbarButtonProps = ComponentPropsWithoutRef<
  typeof ToolbarPrimitive.Button
> &
  Omit<VariantProps<typeof toolbarButtonVariants>, "chrome">;

export const ToolbarButton = ({
  className,
  size,
  variant,
  ...props
}: ToolbarButtonProps) => {
  const chrome = useContext(ToolbarChromeContext);
  return (
    <ToolbarPrimitive.Button
      className={cn(
        toolbarButtonVariants({ chrome, size, variant }),
        className
      )}
      {...props}
    />
  );
};

export const ToolbarLink = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Link>) => {
  const chrome = useContext(ToolbarChromeContext);
  return (
    <ToolbarPrimitive.Link
      className={cn(toolbarButtonVariants({ chrome }), className)}
      {...props}
    />
  );
};

export const ToolbarInput = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Input>) => (
  <ToolbarPrimitive.Input
    className={cn(
      inputControlClassName,
      "h-8 min-w-32 rounded-md border border-border bg-detail px-3 text-body-sm shadow-sm squircle read-only:cursor-default read-only:bg-detail dark:border-transparent",
      className
    )}
    {...props}
  />
);

export const ToolbarSeparator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>) => (
  <ToolbarPrimitive.Separator
    className={cn("mx-1 h-6 w-px bg-border", className)}
    {...props}
  />
);
