import { HugeiconsIcon } from "@hugeicons/react-native";
import type { ComponentProps } from "react";
import { useResolveClassNames } from "uniwind";

import { cn } from "#/lib/cn";

export type { IconSvgElement } from "@hugeicons/react-native";

type IconProps = Omit<
  ComponentProps<typeof HugeiconsIcon>,
  "className" | "color"
> & {
  className?: string;
  strokeWidth?: number;
};

export const Icon = ({ className, strokeWidth = 1.5, ...props }: IconProps) => {
  const { color } = useResolveClassNames(cn("text-fg", className));
  return <HugeiconsIcon color={color} strokeWidth={strokeWidth} {...props} />;
};
