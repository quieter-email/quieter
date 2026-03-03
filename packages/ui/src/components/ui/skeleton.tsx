import type { ComponentProps } from "solid-js";
import * as SkeletonPrimitive from "@kobalte/core/skeleton";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type SkeletonProps = ComponentProps<typeof SkeletonPrimitive.Root>;

export const Skeleton = (props: SkeletonProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SkeletonPrimitive.Root
      class={cn(
        "relative overflow-hidden border border-border/70 bg-muted/70",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[quietr-shimmer_1.5s_linear_infinite] before:bg-gradient-to-r before:from-transparent before:via-background/60 before:to-transparent",
        local.class,
      )}
      {...others}
    />
  );
};
