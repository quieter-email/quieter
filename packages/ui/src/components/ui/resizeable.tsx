import type { ComponentProps } from "solid-js";
import ResizablePrimitive from "@corvu/resizable";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export const Resizable = ResizablePrimitive;

export type ResizableProps = ComponentProps<typeof Resizable>;

export type ResizablePanelProps = ComponentProps<typeof Resizable.Panel>;

export type ResizableHandleProps = ComponentProps<typeof Resizable.Handle> & {
  innerClass?: string;
};

export const ResizablePanel = (props: ResizablePanelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <Resizable.Panel class={cn("overflow-hidden", local.class)} {...others} />;
};

export const ResizableHandle = (props: ResizableHandleProps) => {
  const [local, others] = splitProps(props, ["class", "children", "aria-label", "innerClass"]);

  return (
    <Resizable.Handle
      aria-label={local["aria-label"] ?? "Resize panels"}
      class={cn(
        "group shrink-0 basis-3",
        "data-[orientation=horizontal]:px-0.75 data-[orientation=vertical]:py-0.75",
        local.class,
      )}
      {...others}
    >
      {local.children ??
        (local.innerClass ? (
          <div class={cn("size-full rounded-sm", local.innerClass)} />
        ) : (
          <div class="size-full rounded-sm bg-border/50 transition-colors group-data-active:bg-muted-foreground/20 group-data-dragging:bg-primary/50" />
        ))}
    </Resizable.Handle>
  );
};
