"use client";

import type { ComponentRef, ReactNode, Ref } from "react";
import {
  Button as ButtonPrimitive,
  type ButtonProps as BaseUIButtonProps,
} from "@base-ui/react/button";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "squircle inline-flex border border-transparent shrink-0 items-center justify-center gap-2 rounded-md text-sm whitespace-nowrap transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg shadow-sm hover:bg-primary/90 active:bg-primary/85",
        outline: "border-border bg-bg-surface text-fg shadow-sm hover:bg-muted active:bg-muted/80",
        ghost:
          "bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:bg-muted/80 active:text-fg aria-[current=page]:bg-muted aria-[current=page]:text-fg",
        destructive:
          "bg-destructive text-destructive-fg shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
      },
      size: {
        "icon-xs": "size-7 p-0 [&_svg]:size-3.5",
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
    pending?: boolean;
    pendingLabel?: ReactNode;
    ref?: Ref<ComponentRef<typeof ButtonPrimitive>>;
  };

export const Button = ({
  className,
  pending = false,
  pendingLabel,
  ref,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) => {
  const content = pending ? (
    <span className="inline-grid place-items-center">
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 inline-flex items-center gap-2"
      >
        {props.children}
      </span>
      <span className="col-start-1 row-start-1 inline-flex items-center gap-2">
        <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        {pendingLabel}
      </span>
      {pendingLabel === undefined ? <span className="sr-only">{props.children}</span> : null}
    </span>
  ) : (
    props.children
  );

  return (
    <ButtonPrimitive
      {...props}
      aria-busy={pending || undefined}
      className={
        typeof className === "function"
          ? (state) => cn(buttonVariants({ size, variant }), className(state))
          : cn(buttonVariants({ size, variant }), className)
      }
      disabled={pending || props.disabled}
      ref={ref}
      type={type}
    >
      {content}
    </ButtonPrimitive>
  );
};

const LinkButtonComponent = createLink(Button);

export const LinkButton: LinkComponent<typeof Button> = (props) => {
  const linkProps = {
    ...props,
    className: cn("cursor-pointer", props.className),
    preload: props.preload ?? "viewport",
  };

  return <LinkButtonComponent {...linkProps} />;
};
