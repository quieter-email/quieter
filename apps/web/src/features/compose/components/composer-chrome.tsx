"use client";

import { cn } from "@quieter/ui/cn";
import { Field, FieldError, FieldLabel } from "@quieter/ui/field";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Chrome shared by the mail and template composers: one writing measure, a capped
 * height so the sheet never stretches edge to edge, a single grouped header instead
 * of a stack of standalone fields, and a footer toolbar that reads as its own band.
 */
export const ComposerFrame = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "mx-auto my-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 md:max-h-[42rem]",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

/** The one element that holds every header input, hairline-divided rather than boxed. */
export const ComposerFieldGroup = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "squircle w-full shrink-0 overflow-hidden rounded-xl border border-border bg-control shadow-sm",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

/**
 * Header inputs deliberately carry no focus ring; the row tints instead, which keeps
 * the group reading as one surface while still marking where the caret is.
 */
export const composerFieldControlClassName =
  "h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm shadow-none read-only:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none";

const composerFieldRowClassName =
  "flex items-center gap-3 px-4 transition-colors duration-150 ease-out focus-within:bg-bg-surface";

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
      <FieldLabel className="w-16 shrink-0 text-sm font-normal text-muted-fg">
        {label}
      </FieldLabel>
      {children}
      {trailing}
    </div>
    {error === undefined ? null : (
      <FieldError className="px-4 pb-2 pl-20 text-xs">{error}</FieldError>
    )}
  </Field>
);

/** Body and toolbar share one card so the toolbar reads as the sheet's own footer. */
export const ComposerEditorFrame = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "squircle flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-control shadow-sm",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
