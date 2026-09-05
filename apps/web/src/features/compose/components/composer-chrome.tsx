"use client";

import { cn } from "@quieter/ui/cn";
import { Field, FieldError, FieldLabel } from "@quieter/ui/field";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** Chrome shared by the mail and template composers. */
export const ComposerFrame = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "mx-auto my-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-2 md:max-h-[28rem]",
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
      "squircle w-full shrink-0 overflow-hidden rounded-lg border border-border bg-control",
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
  "h-10 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-body shadow-none read-only:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none";

const composerFieldRowClassName =
  "flex items-center gap-2.5 px-3.5 transition-colors duration-150 ease-out focus-within:bg-bg-surface";

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
      "squircle flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-control shadow-sm transition-shadow duration-150 focus-within:shadow-md",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
