"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonProps as BaseUIButtonProps } from "@base-ui/react/button";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createLink } from "@tanstack/react-router";
import type { LinkComponent } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentRef, ReactNode, Ref } from "react";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex border border-transparent shrink-0 items-center justify-center gap-2 rounded-md text-body whitespace-nowrap transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        // Full-width bar action at default height, e.g. auth buttons.
        block:
          "group relative h-8 w-full justify-center gap-3 px-3 [&_svg]:size-4",
        // Caption-height action, e.g. retry and approval buttons.
        compact: "h-7 px-2 text-caption font-medium [&_svg]:size-3.5",
        default: "h-8 px-3 text-body-sm [&_svg]:size-4",
        icon: "size-8 p-0 [&_svg]:size-4",
        "icon-lg": "size-9 p-0 [&_svg]:size-4.5",
        "icon-sm": "size-7 p-0 [&_svg]:size-3.5",
        "icon-xs": "size-6 p-0 [&_svg]:size-3.5",
        lg: "h-10 px-5 text-body-lg [&_svg]:size-4.5",
        sm: "h-7 px-2.5 text-body-sm [&_svg]:size-3.5",
      },
      variant: {
        // Large selectable card, e.g. the mailbox-type options.
        card: "group h-auto min-h-32 w-full flex-col items-start justify-start rounded-lg border-border bg-bg-raised p-5 text-left text-fg whitespace-normal hover:border-border-strong hover:bg-control-hover active:bg-control-active",
        // Compact toggle chip, e.g. the Cc/Bcc switches. The pressed look
        // follows aria-pressed so callers only pass the state.
        chip: "h-7 px-1.5 text-caption text-muted-fg aria-pressed:bg-control-active aria-pressed:text-fg",
        default:
          "bg-primary text-primary-fg shadow-sm hover:bg-primary/90 active:bg-primary/85",
        destructive:
          "bg-destructive text-destructive-fg shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
        ghost:
          "bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:bg-control-active active:text-fg aria-[current=page]:bg-muted aria-[current=page]:text-fg",
        // Segmented option, e.g. the rule-builder choices. The selected look
        // follows aria-pressed so callers only pass the state.
        option:
          "bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:bg-control-active active:text-fg aria-pressed:bg-bg-surface aria-pressed:text-fg aria-pressed:shadow-sm",
        outline:
          "border-border bg-control text-fg hover:bg-control-hover active:bg-control-active",
        // Outline treatment for dark backdrops, e.g. the status screens.
        overlay:
          "border-fg/20 bg-transparent text-fg hover:bg-fg/10 active:bg-fg/15",
        // Full-width result row, e.g. settings search. The active look
        // follows data-active so callers only pass the state.
        result:
          "h-auto w-full justify-start bg-transparent py-4 text-left font-normal whitespace-normal text-muted-fg hover:bg-muted hover:text-fg data-[active=true]:bg-accent",
        // Quiet secondary action, e.g. the stop-response button.
        secondary:
          "bg-muted text-fg shadow-sm hover:bg-control-hover active:bg-control-active",
      },
    },
  }
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
        <HugeiconsIcon
          aria-hidden
          className="size-4 animate-spin"
          icon={Loading03Icon}
        />
        {pendingLabel}
      </span>
      {pendingLabel === undefined ? (
        <span className="sr-only">{props.children}</span>
      ) : null}
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
