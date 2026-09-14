import { ActivityIndicator } from "react-native";
import { useResolveClassNames } from "uniwind";

import { cn } from "#/lib/cn";

type SpinnerProps = {
  className?: string;
  size?: "small" | "large";
};

export const Spinner = ({ className, size = "small" }: SpinnerProps) => {
  const { color } = useResolveClassNames(cn("text-muted-fg", className));
  return <ActivityIndicator color={color} size={size} />;
};
