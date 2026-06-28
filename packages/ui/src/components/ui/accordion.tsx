"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cn } from "../../lib/cn";
import { ChevronDownIcon } from "./icons";

export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>) => (
  <AccordionPrimitive.Item
    className={cn("overflow-hidden rounded-lg border bg-card text-card-foreground", className)}
    {...props}
  />
);

export const AccordionHeader = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Header>) => (
  <AccordionPrimitive.Header className={cn("contents", className)} {...props} />
);

export const AccordionTrigger = ({
  children,
  className,
  indicator,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & {
  indicator?: ReactNode;
}) => (
  <AccordionPrimitive.Trigger
    className={cn(
      "flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-transform duration-100 ease-out outline-none squircle hover:bg-muted/40 focus-visible:bg-muted/40 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 flex-1">{children}</span>
    <span className="shrink-0 text-muted-foreground">
      {indicator ?? <ChevronDownIcon className="size-4" />}
    </span>
  </AccordionPrimitive.Trigger>
);

export const AccordionPanel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Panel>) => (
  <AccordionPrimitive.Panel
    className={cn("overflow-hidden border-t px-4 py-3 text-sm text-muted-foreground", className)}
    {...props}
  />
);
