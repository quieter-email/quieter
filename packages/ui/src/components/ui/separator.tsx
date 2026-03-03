import type { ComponentProps } from "solid-js";
import * as SeparatorPrimitive from "@kobalte/core/separator";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type SeparatorProps = ComponentProps<typeof SeparatorPrimitive.Root>;

export const Separator = (props: SeparatorProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SeparatorPrimitive.Root
      class={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        local.class,
      )}
      {...others}
    />
  );
};
