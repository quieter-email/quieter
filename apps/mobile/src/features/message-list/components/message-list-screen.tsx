import {
  Refresh01Icon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import type { MailCategory } from "@quieter/mail/data-plane";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { buildThreadListEntries } from "@quieter/mail/thread-list";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "#/components/ui/icon";
import { IconButton } from "#/components/ui/icon-button";
import { Surface } from "#/components/ui/surface";
import { Text } from "#/components/ui/text";
import { TextField } from "#/components/ui/text-field";
import {
  setDrawerOpen,
  setSearchQuery,
  useMailboxCategory,
  useSelectedMailboxId,
  useWorkspaceSearchQuery,
} from "#/features/workspace/workspace-store";
import { ignoreFailure } from "#/lib/async";
import { cn } from "#/lib/cn";
import { api } from "#/lib/orpc";

import { ThreadRow } from "./thread-row";

const CATEGORY_LABELS: Record<MailCategory, string> = {
  archive: "Archive",
  drafts: "Drafts",
  inbox: "Inbox",
  sent: "Sent",
  spam: "Spam",
  trash: "Trash",
  unread: "Unread",
};

const getEmptyLabel = (category: MailCategory, searchQuery: string) => {
  if (category === "drafts") {
    return searchQuery.length > 0 ? "No drafts found." : "No drafts.";
  }
  return searchQuery.length > 0 ? "No messages found." : "No messages.";
};

const CAUGHT_UP_LABEL = "You're all caught up.";

const getUserLabels = (labels: MailboxLabel[]) =>
  labels
    .filter((label) => label.type === "user" && label.visible)
    .toSorted((first, second) => first.position - second.position);

export const MessageListScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mailboxId = useSelectedMailboxId();
  const category = useMailboxCategory();
  const searchQuery = useWorkspaceSearchQuery();
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [activeLabelName, setActiveLabelName] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  const labelsQuery = useQuery({
    ...api.mail.labels(mailboxId ?? ""),
    enabled: mailboxId !== null,
  });
  const labels = getUserLabels(labelsQuery.data ?? []);

  const listQuery = useInfiniteQuery({
    ...api.mail.messagesInfinite({
      category,
      mailboxId: mailboxId ?? "",
      query: searchQuery,
    }),
    enabled: mailboxId !== null,
  });

  const entries = useMemo(
    () =>
      buildThreadListEntries(
        listQuery.data?.pages.flatMap((page) => page.messages) ?? []
      ),
    [listQuery.data]
  );

  const openLabel = (label: MailboxLabel) => {
    if (activeLabelName === label.name) {
      setActiveLabelName(null);
      setSearchInput("");
      setSearchQuery("");
      return;
    }
    setActiveLabelName(label.name);
    const nextQuery = `label:"${label.name}"`;
    setSearchInput(nextQuery);
    setSearchQuery(nextQuery);
  };

  const isLoadingFirstPage =
    listQuery.isPending && listQuery.fetchStatus !== "idle";

  return (
    <View className="flex-1 bg-bg">
      <View style={{ paddingTop: insets.top }}>
        <View className="min-h-12 flex-row items-center gap-1 px-1">
          <IconButton
            label="Open sidebar"
            onPress={() => {
              setDrawerOpen(true);
            }}
            size="sm"
          >
            <Icon icon={SidebarLeftIcon} size={18} />
          </IconButton>
          <Text
            className="min-w-0 flex-1 text-title-sm font-medium tracking-tight"
            numberOfLines={1}
          >
            {CATEGORY_LABELS[category]}
          </Text>
          <IconButton
            label="Refresh list"
            onPress={() => {
              void ignoreFailure(listQuery.refetch());
            }}
            size="sm"
          >
            <Icon icon={Refresh01Icon} size={18} />
          </IconButton>
        </View>

        <View className="flex-row items-center gap-2 px-2 pb-2">
          <View className="flex-1 flex-row items-center gap-2 rounded-md border border-border bg-input px-3">
            <Icon className="text-muted-fg" icon={Search01Icon} size={16} />
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0"
              onChangeText={setSearchInput}
              placeholder="Search mail"
              returnKeyType="search"
              value={searchInput}
            />
          </View>
        </View>

        {labels.length > 0 && category === "inbox" ? (
          <ScrollView
            className="pb-2"
            contentContainerClassName="gap-2 px-2"
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {labels.map((label) => (
              <Pressable
                className={cn(
                  "rounded-sm border border-border bg-control px-2.5 py-1 active:bg-control-hover",
                  { "bg-muted": activeLabelName === label.name }
                )}
                key={label.id}
                onPress={() => {
                  openLabel(label);
                }}
              >
                <Text className="text-caption text-muted-fg">{label.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <Surface className="m-1.5 flex-1 border-border">
        {isLoadingFirstPage ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(entry) => entry.threadId}
            ListEmptyComponent={
              <Text className="px-4 py-8 text-muted-fg">
                {getEmptyLabel(category, searchQuery)}
              </Text>
            }
            ListFooterComponent={
              entries.length === 0 ? null : (
                <View className="items-center py-5">
                  {listQuery.isFetchingNextPage || listQuery.hasNextPage ? (
                    <ActivityIndicator />
                  ) : (
                    <Text className="text-caption text-muted-fg">
                      {CAUGHT_UP_LABEL}
                    </Text>
                  )}
                </View>
              )
            }
            onEndReached={() => {
              if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
                void ignoreFailure(listQuery.fetchNextPage());
              }
            }}
            onEndReachedThreshold={0.5}
            onRefresh={() => {
              void ignoreFailure(listQuery.refetch());
            }}
            refreshing={listQuery.isRefetching && !listQuery.isFetchingNextPage}
            renderItem={({ item }) => (
              <ThreadRow
                category={category}
                entry={item}
                mailboxId={mailboxId ?? ""}
                onPress={() => {
                  router.push({
                    params: { threadId: item.threadId },
                    pathname: "/thread",
                  });
                }}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          />
        )}
      </Surface>
    </View>
  );
};
