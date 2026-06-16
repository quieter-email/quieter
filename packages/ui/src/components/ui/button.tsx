"use client";

import type { ComponentRef, Ref } from "react";
import {
  Button as ButtonPrimitive,
  type ButtonProps as BaseUIButtonProps,
} from "@base-ui/react/button";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "group/button squircle relative isolate inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-md text-sm whitespace-nowrap transition-transform duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm",
        outline: "border border-input bg-background-dark text-foreground shadow-sm",
        ghost: "bg-transparent text-muted-foreground hover:text-foreground active:text-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-sm",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px] [&_svg]:size-3.5",
        default: "h-9 px-4 text-sm [&_svg]:size-4",
        lg: "h-10 px-5 text-base [&_svg]:size-4.5",
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

const buttonHoverLayerVariants = cva(
  "squircle pointer-events-none absolute -inset-px rounded-md opacity-0 transition-[inset,opacity] duration-100 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/button:inset-0 group-hover/button:opacity-100 group-active/button:inset-px group-active/button:opacity-100 group-focus-visible/button:inset-0 group-focus-visible/button:opacity-100 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "bg-primary-foreground/10",
        outline: "bg-input/45",
        ghost: "bg-muted/60",
        destructive: "bg-destructive-foreground/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type ButtonProps = BaseUIButtonProps &
  VariantProps<typeof buttonVariants> & {
    hoverLayer?: boolean;
    ref?: Ref<ComponentRef<typeof ButtonPrimitive>>;
  };

export const Button = ({
  children,
  className,
  hoverLayer = true,
  ref,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) => (
  <ButtonPrimitive
    ref={ref}
    className={
      typeof className === "function"
        ? (state) => cn(buttonVariants({ size, variant }), className(state))
        : cn(buttonVariants({ size, variant }), className)
    }
    type={type}
    {...props}
  >
    {hoverLayer && <span aria-hidden className={buttonHoverLayerVariants({ variant })} />}
    <span className="justify-[inherit] relative z-10 flex w-full min-w-0 items-center gap-[inherit]">
      {children}
    </span>
  </ButtonPrimitive>
);

const LinkButtonComponent = createLink(Button);

export const LinkButton: LinkComponent<typeof Button> = (props) => {
  const linkProps = {
    ...props,
    className: cn("cursor-pointer", props.className),
    preload: props.preload ?? "viewport",
  };

  return <LinkButtonComponent {...linkProps} />;
};
