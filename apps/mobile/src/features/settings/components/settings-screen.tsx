import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, View } from "react-native";

import { MobileHeader } from "#/components/mobile-header";
import { Button } from "#/components/ui/button";
import { Icon } from "#/components/ui/icon";
import { Surface } from "#/components/ui/surface";
import { Text } from "#/components/ui/text";
import { authClient } from "#/lib/auth-client";
import { cn } from "#/lib/cn";
import { webUrl } from "#/lib/env";
import { setThemePreference, useThemePreference } from "#/lib/theme";
import type { ThemePreference } from "#/lib/theme";

const themeOptions: { label: string; value: ThemePreference }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const SettingsRow = ({
  label,
  onPress,
  trailing,
}: {
  label: string;
  onPress?: () => void;
  trailing?: string;
}) => (
  <Pressable
    accessibilityRole={onPress === undefined ? undefined : "button"}
    className="flex-row items-center gap-3 border-b border-border px-4 py-3.5 active:bg-control-hover"
    disabled={onPress === undefined}
    onPress={onPress}
  >
    <Text className="min-w-0 flex-1">{label}</Text>
    {trailing === undefined ? null : (
      <Text className="text-caption text-muted-fg">{trailing}</Text>
    )}
  </Pressable>
);

export const SettingsScreen = () => {
  const router = useRouter();
  const themePreference = useThemePreference();
  const { data: session } = authClient.useSession();

  return (
    <View className="flex-1 bg-bg">
      <MobileHeader
        leading="back"
        onLeadingClick={() => {
          router.back();
        }}
        title="Settings"
      />
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-2 pb-8">
        <Surface className="m-0">
          <View className="p-4">
            <Text className="font-medium">
              {session?.user.name ?? "Account"}
            </Text>
            <Text className="text-caption text-muted-fg">
              {session?.user.email ?? ""}
            </Text>
          </View>
          <SettingsRow
            label="Sign out"
            onPress={() => {
              void authClient.signOut();
            }}
          />
        </Surface>

        <View>
          <Text className="px-2 pb-1 text-caption font-medium text-muted-fg">
            Appearance
          </Text>
          <Surface className="m-0">
            <View className="flex-row gap-2 p-3">
              {themeOptions.map((option) => {
                const isActive = themePreference === option.value;
                return (
                  <Pressable
                    className={cn(
                      "h-10 flex-1 flex-row items-center justify-center gap-2 rounded-md border border-border bg-control active:bg-control-hover",
                      { "bg-muted": isActive }
                    )}
                    key={option.value}
                    onPress={() => {
                      setThemePreference(option.value);
                    }}
                  >
                    {isActive ? (
                      <Icon className="text-fg" icon={Tick02Icon} size={14} />
                    ) : null}
                    <Text className="text-body-sm">{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Surface>
        </View>

        <View>
          <Text className="px-2 pb-1 text-caption font-medium text-muted-fg">
            About
          </Text>
          <Surface className="m-0">
            <SettingsRow
              label="Help and legal"
              onPress={() => {
                void Linking.openURL(`${webUrl}/imprint`);
              }}
            />
            <SettingsRow
              label="Privacy policy"
              onPress={() => {
                void Linking.openURL(`${webUrl}/privacy`);
              }}
            />
            <SettingsRow
              label="Terms of service"
              onPress={() => {
                void Linking.openURL(`${webUrl}/terms`);
              }}
            />
          </Surface>
        </View>

        <Button
          className="mx-1"
          onPress={() => {
            router.back();
          }}
          variant="ghost"
        >
          Back to mail
        </Button>
      </ScrollView>
    </View>
  );
};
