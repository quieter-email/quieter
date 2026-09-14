import type { ReactNode } from "react";
import { Pressable } from "react-native";
import type { PressableProps } from "react-native";

import { cn } from "#/lib/cn";

type IconButtonProps = Omit<PressableProps, "children"> & {
  children: ReactNode;
  label: string;
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  lg: "size-11 rounded-md",
  md: "size-10 rounded-md",
  sm: "size-8 rounded-md",
} as const;

export const IconButton = ({
  children,
  className,
  label,
  size = "md",
  ...props
}: IconButtonProps) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    className={cn(
      "items-center justify-center active:bg-control-hover",
      sizeClasses[size],
      className
    )}
    hitSlop={4}
    {...props}
  >
    {children}
  </Pressable>
);
