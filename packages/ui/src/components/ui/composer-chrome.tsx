"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";
import { Field, FieldError, FieldLabel } from "./field";
import { Icon } from "./icon";
import { IconButtonTooltip } from "./icon-button-tooltip";

export const PromptComposerFrame = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-control p-2 shadow-sm",
      className
    )}
    {...props}
  />
);

export const ComposerContextChip = ({
  disabled,
  icon,
  label,
  onRemove,
}: {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onRemove: () => void;
}) => (
  <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border border-border bg-bg-surface pl-2 text-caption text-muted-fg">
    {icon}
    <span className="min-w-0 truncate" title={label}>
      {label}
    </span>
    <IconButtonTooltip label={`Remove ${label}`}>
      <Button
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={onRemove}
        size="icon-xs"
        variant="ghost"
      >
        <Icon aria-hidden icon={Cancel01Icon} />
      </Button>
    </IconButtonTooltip>
  </span>
);

/** Shared chrome for the mail composer. */
export const ComposerFrame = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "mx-auto my-auto flex min-h-0 w-full max-w-[58rem] flex-1 flex-col gap-2 md:max-h-[28rem]",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

/** The one element that holds every header input, hairline-divided rather than boxed. */
export const ComposerFieldGroup = ({
  bare = false,
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  bare?: boolean;
}) => (
  <div
    className={cn(
      "w-full shrink-0 overflow-hidden rounded-lg border border-border bg-control",
      { "rounded-none border-0 bg-transparent shadow-none": bare },
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const composerFieldRowClassName =
  "flex min-w-0 items-center gap-2.5 px-5 transition-colors duration-150 ease-out focus-within:bg-bg-surface";

export const ComposerFieldRow = ({
  children,
  className,
  divided = true,
  error,
  label,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  divided?: boolean;
  error?: string;
  label: string;
  trailing?: ReactNode;
}) => (
  <Field
    className={cn("gap-0", { "border-b border-border": divided }, className)}
  >
    <div className={composerFieldRowClassName}>
      <FieldLabel className="w-14 shrink-0 text-body font-normal text-muted-fg">
        {label}
      </FieldLabel>
      {children}
      {trailing}
    </div>
    {error === undefined ? null : (
      <FieldError className="px-3.5 pb-2 pl-[4.75rem] text-caption">
        {error}
      </FieldError>
    )}
  </Field>
);

/** Body, headers, and toolbar share one quiet writing surface. */
export const ComposerEditorFrame = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-control shadow-sm transition-shadow duration-150 squircle focus-within:shadow-md",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
