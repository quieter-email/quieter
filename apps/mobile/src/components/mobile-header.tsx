import { ArrowLeft01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { View } from "react-native";

import { cn } from "#/lib/cn";

import { Icon } from "./ui/icon";
import { IconButton } from "./ui/icon-button";
import { Text } from "./ui/text";

const leadingIcons = {
  back: { glyph: ArrowLeft01Icon, label: "Back to list" },
  sidebar: { glyph: SidebarLeftIcon, label: "Open sidebar" },
} as const;

type MobileHeaderProps = {
  children?: ReactNode;
  className?: string;
  leading: keyof typeof leadingIcons;
  onLeadingClick: () => void;
  title?: string;
};

/**
 * The single narrow-viewport header for every product surface, mirroring the
 * web `MobileHeader`: one height, one icon size, one border.
 */
export const MobileHeader = ({
  children,
  className,
  leading,
  onLeadingClick,
  title,
}: MobileHeaderProps) => {
  const { glyph, label } = leadingIcons[leading];

  return (
    <View
      className={cn(
        "min-h-12 shrink-0 flex-row items-center gap-2 border-b border-border px-2",
        className
      )}
    >
      <IconButton label={label} onPress={onLeadingClick} size="sm">
        <Icon icon={glyph} size={18} />
      </IconButton>
      {title === undefined || title === "" ? null : (
        <Text
          className="min-w-0 flex-1 shrink font-medium tracking-tight"
          numberOfLines={1}
        >
          {title}
        </Text>
      )}
      {children === undefined ? null : (
        <View className="ml-auto flex-row items-center gap-1">{children}</View>
      )}
    </View>
  );
};
