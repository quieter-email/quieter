import type { ReactNode } from "react";
import { Pressable } from "react-native";
import type { PressableProps } from "react-native";

import { cn } from "#/lib/cn";

import { Spinner } from "./spinner";
import { Text } from "./text";

type ButtonVariant = "default" | "destructive" | "ghost" | "outline";
type ButtonSize = "default" | "sm" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  default: "border-transparent bg-primary text-primary-fg",
  destructive: "border-transparent bg-destructive text-destructive-fg",
  ghost: "border-transparent bg-transparent text-muted-fg",
  outline: "border-border bg-control text-fg",
};

const variantTextClasses: Record<ButtonVariant, string> = {
  default: "text-primary-fg",
  destructive: "text-destructive-fg",
  ghost: "text-muted-fg",
  outline: "text-fg",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 rounded-md px-4",
  icon: "size-10 rounded-md",
  lg: "h-12 rounded-lg px-5",
  sm: "h-8 rounded-md px-3",
};

const sizeTextClasses: Record<ButtonSize, string> = {
  default: "text-body",
  icon: "text-body",
  lg: "text-body-lg",
  sm: "text-body-sm",
};

type ButtonProps = Omit<PressableProps, "children"> & {
  children: ReactNode;
  pending?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export const Button = ({
  children,
  className,
  disabled,
  pending = false,
  size = "default",
  variant = "default",
  ...props
}: ButtonProps) => (
  <Pressable
    accessibilityRole="button"
    className={cn(
      "flex-row items-center justify-center gap-2 border",
      sizeClasses[size],
      variantClasses[variant],
      {
        "opacity-50": disabled === true || pending,
      },
      className
    )}
    disabled={disabled === true || pending}
    {...props}
  >
    {pending ? <Spinner className={variantTextClasses[variant]} /> : null}
    {typeof children === "string" ? (
      <Text
        className={cn(
          "font-medium",
          sizeTextClasses[size],
          variantTextClasses[variant]
        )}
      >
        {children}
      </Text>
    ) : (
      children
    )}
  </Pressable>
);
