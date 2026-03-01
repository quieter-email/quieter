import type { ComponentProps } from "solid-js";
import * as TextFieldPrimitive from "@kobalte/core/text-field";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

const textFieldInputVariants = cva(
  "w-full border border-input bg-background text-foreground shadow-sm outline-none transition-all duration-150 ease-out placeholder:text-muted-foreground hover:border-foreground/20 hover:shadow-md focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:shadow-md read-only:cursor-default read-only:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-readonly:cursor-default data-readonly:bg-muted/30 aria-invalid:border-destructive/80 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/30",
  {
    variants: {
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-10 px-3 text-sm",
        lg: "h-11 px-4 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export type TextFieldProps = ComponentProps<typeof TextFieldPrimitive.Root>;

type TextFieldInputSize = NonNullable<VariantProps<typeof textFieldInputVariants>["size"]>;

const isTextFieldInputSize = (value: unknown): value is TextFieldInputSize =>
  value === "sm" || value === "default" || value === "lg";

export type TextFieldInputProps = ComponentProps<typeof TextFieldPrimitive.Input> & {
  size?: ComponentProps<typeof TextFieldPrimitive.Input>["size"] | TextFieldInputSize;
};

export const TextField = (props: TextFieldProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <TextFieldPrimitive.Root class={cn("grid w-full gap-1.5", local.class)} {...others} />;
};

export const TextFieldLabel = (props: ComponentProps<typeof TextFieldPrimitive.Label>) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <TextFieldPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export const TextFieldInput = (props: TextFieldInputProps) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  const visualSize = () => (isTextFieldInputSize(local.size) ? local.size : undefined);
  const nativeSize = () => (typeof local.size === "number" ? local.size : undefined);

  return (
    <TextFieldPrimitive.Input
      size={nativeSize()}
      class={cn(
        textFieldInputVariants({
          size: visualSize(),
        }),
        local.class,
      )}
      {...others}
    />
  );
};

export const TextFieldDescription = (
  props: ComponentProps<typeof TextFieldPrimitive.Description>,
) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <TextFieldPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export const TextFieldErrorMessage = (
  props: ComponentProps<typeof TextFieldPrimitive.ErrorMessage>,
) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <TextFieldPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
