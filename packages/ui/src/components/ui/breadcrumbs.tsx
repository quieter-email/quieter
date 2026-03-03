import type { ComponentProps } from "solid-js";
import * as BreadcrumbsPrimitive from "@kobalte/core/breadcrumbs";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type BreadcrumbsProps = ComponentProps<typeof BreadcrumbsPrimitive.Root>;

export const Breadcrumbs = (props: BreadcrumbsProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <BreadcrumbsPrimitive.Root
      class={cn("flex items-center gap-2 text-sm text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type BreadcrumbsLinkProps = ComponentProps<typeof BreadcrumbsPrimitive.Link>;

export const BreadcrumbsLink = (props: BreadcrumbsLinkProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <BreadcrumbsPrimitive.Link
      class={cn(
        "transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type BreadcrumbsSeparatorProps = ComponentProps<typeof BreadcrumbsPrimitive.Separator>;

export const BreadcrumbsSeparator = (props: BreadcrumbsSeparatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <BreadcrumbsPrimitive.Separator class={cn("text-muted-foreground/70", local.class)} {...others}>
      {local.children ?? "/"}
    </BreadcrumbsPrimitive.Separator>
  );
};
