import type { ReactNode } from "react";
import { Pressable } from "react-native";

import { Text } from "#/components/ui/text";
import { cn } from "#/lib/cn";

type SidebarNavItemProps = {
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  onPress: () => void;
};

export const SidebarNavItem = ({
  active = false,
  badge,
  children,
  className,
  onPress,
}: SidebarNavItemProps) => (
  <Pressable
    accessibilityRole="button"
    className={cn(
      "h-9 flex-row items-center gap-3 rounded-md px-3",
      {
        "bg-muted": active,
      },
      className
    )}
    onPress={onPress}
  >
    {children}
    {badge === undefined ? null : <Text className="ml-auto">{badge}</Text>}
  </Pressable>
);
