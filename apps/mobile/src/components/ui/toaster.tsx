import { Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { dismissToast, useToasts } from "#/lib/toast";

import { Icon } from "./icon";
import { Text } from "./text";

export const Toaster = () => {
  const toasts = useToasts();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View
      className="absolute inset-x-0 bottom-0 z-50 items-center gap-3 px-4"
      pointerEvents="box-none"
      style={{ paddingBottom: insets.bottom + 16 }}
    >
      {toasts.map((entry) => (
        <Animated.View
          className="w-full max-w-[22.5rem]"
          entering={FadeInDown.duration(180)}
          exiting={FadeOut.duration(120)}
          key={entry.id}
        >
          <Pressable
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            className="flex-row items-start gap-3 rounded-xl border border-border bg-popover p-4 shadow-lg active:opacity-90"
            onPress={() => {
              dismissToast(entry.id);
            }}
          >
            {entry.tone === "error" ? (
              <Icon
                className="mt-0.5 text-destructive"
                icon={Alert02Icon}
                size={16}
              />
            ) : null}
            <Text className="min-w-0 flex-1 font-medium text-popover-fg">
              {entry.message}
            </Text>
            <Icon className="text-muted-fg" icon={Cancel01Icon} size={14} />
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
};
