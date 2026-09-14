import { LinearGradient } from "expo-linear-gradient";
import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { cn } from "#/lib/cn";

type SurfaceProps = PropsWithChildren<{
  className?: string;
}>;

/**
 * Workspace panel chrome: the RN equivalent of the web's `WorkspaceSection`
 * surface (`rounded-xl border border-border bg-bg-raised shadow-surface`
 * with the panel gradient).
 */
export const Surface = ({ children, className }: SurfaceProps) => {
  const from = useResolveClassNames("bg-bg-surface").backgroundColor;
  const to = useResolveClassNames("bg-bg-raised").backgroundColor;
  const colors: [string, string] | null =
    typeof from === "string" && typeof to === "string" ? [from, to] : null;

  return (
    <View
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-bg-raised",
        className
      )}
    >
      {colors === null ? null : (
        <LinearGradient
          colors={colors}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </View>
  );
};
