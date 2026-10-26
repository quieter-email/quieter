"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonProps as BaseUIButtonProps } from "@base-ui/react/button";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { createLink } from "@tanstack/react-router";
import type { LinkComponent } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { useState } from "react";
import type { ComponentRef, ReactNode, Ref } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";

export const buttonVariants = cva(
  "inline-flex border border-transparent shrink-0 items-center justify-center gap-2 rounded-md text-body font-medium whitespace-nowrap transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    compoundVariants: [
      {
        auxiliaryPress: false,
        className: "active:scale-[0.97] motion-reduce:active:scale-100",
        variant: [
          "card",
          "default",
          "destructive",
          "ghost",
          "outline",
          "overlay",
          "result",
          "secondary",
          "toolbar",
        ],
      },
      {
        auxiliaryPress: false,
        className: "active:bg-control-active",
        variant: ["card", "ghost", "option", "outline", "toolbar"],
      },
      {
        auxiliaryPress: false,
        className: "active:text-fg",
        variant: ["ghost", "option", "toolbar"],
      },
      {
        auxiliaryPress: false,
        className: "active:bg-primary-active",
        variant: "default",
      },
      {
        auxiliaryPress: false,
        className: "active:bg-destructive-active",
        variant: "destructive",
      },
      {
        auxiliaryPress: false,
        className: "active:bg-fg/15",
        variant: "overlay",
      },
      {
        auxiliaryPress: false,
        className: "active:bg-secondary-active",
        variant: "secondary",
      },
    ],
    defaultVariants: {
      auxiliaryPress: false,
      size: "default",
      variant: "default",
    },
    variants: {
      auxiliaryPress: { false: null, true: null },
      fullWidth: {
        true: "group relative w-full gap-3",
      },
      size: {
        auto: "h-auto justify-start px-3 py-2 text-left text-body-sm whitespace-normal [&_svg]:size-4",
        // Caption-height action, e.g. retry and approval buttons.
        compact: "h-7 px-2 text-caption font-medium [&_svg]:size-3.5",
        default: "h-8 px-3 text-body-sm [&_svg]:size-4",
        icon: "size-8 p-0 [&_svg]:size-4",
        "icon-lg": "size-9 p-0 [&_svg]:size-4.5",
        "icon-sm": "size-7 p-0 [&_svg]:size-3.5",
        "icon-xs": "size-6 p-0 [&_svg]:size-3.5",
        lg: "h-10 px-5 text-body-lg [&_svg]:size-4.5",
        sm: "h-7 px-2.5 text-body-sm [&_svg]:size-3.5",
        xs: "h-6 px-2 text-caption [&_svg]:size-3",
      },
      variant: {
        // Large selectable card, e.g. the mailbox-type options.
        card: "group h-auto min-h-32 w-full flex-col items-start justify-start rounded-lg border-border bg-bg-raised p-5 text-left text-fg whitespace-normal hover:border-border-strong hover:bg-control-hover",
        // Compact toggle chip, e.g. the Cc/Bcc switches. The pressed look
        // follows aria-pressed so callers only pass the state.
        chip: "h-7 px-1.5 text-caption text-muted-fg active:scale-100 aria-pressed:bg-control-active aria-pressed:text-fg",
        default: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-fg shadow-sm hover:bg-destructive-hover",
        ghost:
          "bg-transparent text-muted-fg hover:bg-muted hover:text-fg aria-[current=page]:bg-muted aria-[current=page]:text-fg aria-[current=true]:bg-muted aria-[current=true]:text-fg",
        "inline-edit":
          "h-5 min-w-0 shrink justify-start rounded-none border-0 bg-transparent p-0 text-left text-body font-normal text-fg active:scale-100",
        // Segmented option, e.g. the rule-builder choices. The selected look
        // follows aria-pressed so callers only pass the state.
        option:
          "bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:scale-100 aria-pressed:bg-bg-surface aria-pressed:text-fg aria-pressed:shadow-sm",
        outline: "border-border bg-control text-fg hover:bg-control-hover",
        // Outline treatment for dark backdrops, e.g. the status screens.
        overlay: "border-fg/20 bg-transparent text-fg hover:bg-fg/10",
        // Full-width result row, e.g. settings search. The active look
        // follows data-active so callers only pass the state.
        result:
          "h-auto w-full justify-start bg-transparent py-4 text-left font-normal whitespace-normal text-muted-fg hover:bg-muted hover:text-fg data-[active=true]:bg-accent",
        // Quiet secondary action, e.g. the stop-response button.
        secondary:
          "bg-secondary text-secondary-fg shadow-sm hover:bg-secondary-hover",
        toolbar:
          "rounded-xl border-border bg-control text-muted-fg hover:bg-control-hover hover:text-fg [&_svg]:size-3.5",
      },
    },
  }
);

export const buttonFooterClassName =
  "squircle min-w-20 px-3.5 font-medium [&_svg]:size-3.5";

export type ButtonProps = BaseUIButtonProps &
  Omit<VariantProps<typeof buttonVariants>, "auxiliaryPress"> & {
    pending?: boolean;
    pendingLabel?: ReactNode;
    ref?: Ref<ComponentRef<typeof ButtonPrimitive>>;
  };

export const Button = ({
  className,
  fullWidth = false,
  onKeyDown,
  onPointerDown,
  pending = false,
  pendingLabel,
  ref,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) => {
  const [isAuxiliaryPress, setIsAuxiliaryPress] = useState(false);
  const content = pending ? (
    <span className="inline-grid place-items-center">
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 inline-flex items-center gap-2"
      >
        {props.children}
      </span>
      <span className="col-start-1 row-start-1 inline-flex items-center gap-2">
        <Icon aria-hidden animation="spin" icon={Loading03Icon} />
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
          ? (state) =>
              cn(
                buttonVariants({
                  auxiliaryPress: isAuxiliaryPress,
                  fullWidth,
                  size,
                  variant,
                }),
                className(state)
              )
          : cn(
              buttonVariants({
                auxiliaryPress: isAuxiliaryPress,
                fullWidth,
                size,
                variant,
              }),
              className
            )
      }
      disabled={pending || props.disabled}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          setIsAuxiliaryPress(false);
        }
        onKeyDown?.(event);
      }}
      onPointerDown={(event) => {
        setIsAuxiliaryPress(event.button !== 0);
        onPointerDown?.(event);
      }}
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
