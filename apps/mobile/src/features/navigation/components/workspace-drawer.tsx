import { useEffect } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  setDrawerOpen,
  useIsDrawerOpen,
} from "#/features/workspace/workspace-store";

import { MailSidebar } from "./mail-sidebar";

const DRAWER_WIDTH = Math.min(320, Dimensions.get("window").width - 40);

const closeDrawer = () => {
  setDrawerOpen(false);
};

export const WorkspaceDrawer = () => {
  const isOpen = useIsDrawerOpen();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(isOpen ? 1 : 0, { duration: 220 });
  }, [isOpen, progress]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-DRAWER_WIDTH, 0]) },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  return (
    <View
      className="absolute inset-0"
      pointerEvents={isOpen ? "auto" : "none"}
      style={{ zIndex: 50 }}
    >
      <Animated.View
        className="bg-bg/50"
        style={[StyleSheet.absoluteFill, backdropStyle]}
      >
        <Pressable
          accessibilityLabel="Close sidebar"
          accessibilityRole="button"
          className="flex-1"
          onPress={closeDrawer}
        />
      </Animated.View>
      <Animated.View
        className="absolute inset-y-0 left-0 bg-bg shadow-2xl"
        style={[
          {
            paddingBottom: insets.bottom,
            paddingTop: insets.top,
            width: DRAWER_WIDTH,
          },
          panelStyle,
        ]}
      >
        <MailSidebar onClose={closeDrawer} />
      </Animated.View>
    </View>
  );
};
