import type { ComponentProps } from "solid-js";
import * as NumberFieldPrimitive from "@kobalte/core/number-field";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

const numberFieldInputVariants = cva(
  "w-full border border-input bg-background text-foreground shadow-sm outline-none transition-all duration-150 ease-out placeholder:text-muted-foreground hover:border-foreground/20 hover:shadow-md focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:shadow-md disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
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

type NumberFieldInputSize = NonNullable<VariantProps<typeof numberFieldInputVariants>["size"]>;

const isNumberFieldInputSize = (value: unknown): value is NumberFieldInputSize =>
  value === "sm" || value === "default" || value === "lg";

export type NumberFieldProps = ComponentProps<typeof NumberFieldPrimitive.Root>;

export const NumberField = (props: NumberFieldProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <NumberFieldPrimitive.Root class={cn("grid w-full gap-1.5", local.class)} {...others} />;
};

export type NumberFieldLabelProps = ComponentProps<typeof NumberFieldPrimitive.Label>;

export const NumberFieldLabel = (props: NumberFieldLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NumberFieldPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type NumberFieldInputProps = ComponentProps<typeof NumberFieldPrimitive.Input> & {
  size?: ComponentProps<typeof NumberFieldPrimitive.Input>["size"] | NumberFieldInputSize;
};

export const NumberFieldInput = (props: NumberFieldInputProps) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  const visualSize = () => (isNumberFieldInputSize(local.size) ? local.size : undefined);
  const nativeSize = () => (typeof local.size === "number" ? local.size : undefined);

  return (
    <NumberFieldPrimitive.Input
      size={nativeSize()}
      class={cn(numberFieldInputVariants({ size: visualSize() }), local.class)}
      {...others}
    />
  );
};

export type NumberFieldIncrementTriggerProps = ComponentProps<
  typeof NumberFieldPrimitive.IncrementTrigger
>;

export const NumberFieldIncrementTrigger = (props: NumberFieldIncrementTriggerProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <NumberFieldPrimitive.IncrementTrigger
      class={cn(
        "inline-flex size-10 items-center justify-center border border-input bg-background text-foreground transition-colors hover:bg-muted/60 data-disabled:pointer-events-none data-disabled:opacity-50",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    >
      {local.children ?? "+"}
    </NumberFieldPrimitive.IncrementTrigger>
  );
};

export type NumberFieldDecrementTriggerProps = ComponentProps<
  typeof NumberFieldPrimitive.DecrementTrigger
>;

export const NumberFieldDecrementTrigger = (props: NumberFieldDecrementTriggerProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <NumberFieldPrimitive.DecrementTrigger
      class={cn(
        "inline-flex size-10 items-center justify-center border border-input bg-background text-foreground transition-colors hover:bg-muted/60 data-disabled:pointer-events-none data-disabled:opacity-50",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    >
      {local.children ?? "-"}
    </NumberFieldPrimitive.DecrementTrigger>
  );
};

export type NumberFieldHiddenInputProps = ComponentProps<typeof NumberFieldPrimitive.HiddenInput>;

export const NumberFieldHiddenInput = (props: NumberFieldHiddenInputProps) => (
  <NumberFieldPrimitive.HiddenInput {...props} />
);

export type NumberFieldDescriptionProps = ComponentProps<typeof NumberFieldPrimitive.Description>;

export const NumberFieldDescription = (props: NumberFieldDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NumberFieldPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type NumberFieldErrorMessageProps = ComponentProps<typeof NumberFieldPrimitive.ErrorMessage>;

export const NumberFieldErrorMessage = (props: NumberFieldErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NumberFieldPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
