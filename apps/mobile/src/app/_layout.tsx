import "../global.css";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
} from "@expo-google-fonts/geist-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaListener } from "react-native-safe-area-context";
import { Uniwind, useResolveClassNames, useUniwind } from "uniwind";

import { Toaster } from "#/components/ui/toaster";
import { ignoreFailure } from "#/lib/async";
import { authClient } from "#/lib/auth-client";
import { queryClient } from "#/lib/query-client";
import { hydrateThemePreference } from "#/lib/theme";

void ignoreFailure(SplashScreen.preventAutoHideAsync());

const RootLayout = () => {
  const { data: session, isPending } = authClient.useSession();
  const { theme } = useUniwind();
  const { backgroundColor } = useResolveClassNames("bg-bg");
  const [fontsLoaded] = useFonts({
    GeistMono_400Regular,
    GeistMono_500Medium,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  useEffect(() => {
    void hydrateThemePreference();
  }, []);

  useEffect(() => {
    void ignoreFailure(
      SystemUI.setBackgroundColorAsync(backgroundColor ?? null)
    );
  }, [backgroundColor, theme]);

  useEffect(() => {
    if (fontsLoaded && !isPending) {
      void ignoreFailure(SplashScreen.hideAsync());
    }
  }, [fontsLoaded, isPending]);

  if (!fontsLoaded || isPending) {
    return null;
  }

  const isAuthenticated = session !== null && session !== undefined;

  return (
    <GestureHandlerRootView className="flex-1 bg-bg">
      <SafeAreaListener
        onChange={({ insets }) => {
          Uniwind.updateInsets(insets);
        }}
      >
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={isAuthenticated}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={!isAuthenticated}>
              <Stack.Screen name="sign-in" />
            </Stack.Protected>
          </Stack>
          <Toaster />
        </QueryClientProvider>
      </SafeAreaListener>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
