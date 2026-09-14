import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { WorkspaceDrawer } from "#/features/navigation/components/workspace-drawer";
import {
  hydrateWorkspaceMailboxId,
  setSelectedMailboxId,
  useSelectedMailboxId,
} from "#/features/workspace/workspace-store";
import { api } from "#/lib/orpc";

const AppLayout = () => {
  const mailboxId = useSelectedMailboxId();
  const mailboxesQuery = useQuery(api.mailboxes.list());

  useEffect(() => {
    void hydrateWorkspaceMailboxId();
  }, []);

  useEffect(() => {
    const { data } = mailboxesQuery;
    if (data === undefined || data.defaultMailboxId === null) {
      return;
    }
    const accessibleIds = new Set(
      data.groups.flatMap((group) =>
        group.mailboxes.map((mailbox) => mailbox.id)
      )
    );
    if (mailboxId !== null && accessibleIds.has(mailboxId)) {
      return;
    }
    setSelectedMailboxId(data.defaultMailboxId);
  }, [mailboxId, mailboxesQuery.data]);

  return (
    <View className="flex-1 bg-bg">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="thread" />
        <Stack.Screen
          name="compose"
          options={{ animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="settings" />
      </Stack>
      <WorkspaceDrawer />
    </View>
  );
};

export default AppLayout;
