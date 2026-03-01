import type { JSX, ParentProps } from "solid-js";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

type DivProps = JSX.HTMLAttributes<HTMLDivElement>;

export const Card = (props: ParentProps<DivProps>) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("border bg-card text-card-foreground", local.class)} {...others}>
      {local.children}
    </div>
  );
};

export const CardHeader = (props: ParentProps<DivProps>) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("flex flex-col gap-1.5 border-b p-4", local.class)} {...others}>
      {local.children}
    </div>
  );
};

export const CardTitle = (props: ParentProps<DivProps>) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("text-base font-medium tracking-tight", local.class)} {...others}>
      {local.children}
    </div>
  );
};

export const CardDescription = (props: ParentProps<DivProps>) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <p class={cn("text-sm text-muted-foreground", local.class)} {...others}>
      {local.children}
    </p>
  );
};

export const CardContent = (props: ParentProps<DivProps>) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("p-4", local.class)} {...others}>
      {local.children}
    </div>
  );
};

export const CardFooter = (props: ParentProps<DivProps>) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <div class={cn("flex items-center border-t p-4", local.class)} {...others}>
      {local.children}
    </div>
  );
};
