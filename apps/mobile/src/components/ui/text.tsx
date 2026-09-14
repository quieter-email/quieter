import type { TextProps } from "react-native";
import { Text as NativeText } from "react-native";

import { cn } from "#/lib/cn";

export const Text = ({ className, ...props }: TextProps) => (
  <NativeText
    className={cn("text-body font-normal text-fg", className)}
    {...props}
  />
);
