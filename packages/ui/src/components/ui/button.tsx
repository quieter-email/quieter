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
  "squircle inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm leading-none font-medium whitespace-nowrap transition-transform duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85",
        outline:
          "border border-input bg-background text-foreground shadow-sm hover:bg-input/40 active:bg-input/60",
        ghost:
          "bg-transparent text-foreground-dark hover:bg-secondary/50 hover:text-foreground active:bg-secondary active:text-foreground-light",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
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

export type ButtonProps = BaseUIButtonProps &
  VariantProps<typeof buttonVariants> & {
    ref?: Ref<ComponentRef<typeof ButtonPrimitive>>;
  };

export const Button = ({
  className,
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
  />
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
