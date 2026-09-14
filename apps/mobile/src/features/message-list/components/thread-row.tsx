import { Archive02Icon } from "@hugeicons/core-free-icons";
import type { MailCategory } from "@quieter/mail/data-plane";
import type { ThreadListEntry } from "@quieter/mail/thread-list";
import { formatMessageListDate } from "@quieter/mail/thread-list";
import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Icon } from "#/components/ui/icon";
import { Text } from "#/components/ui/text";
import { cn } from "#/lib/cn";
import { api } from "#/lib/orpc";
import { queryClient } from "#/lib/query-client";
import { toastError } from "#/lib/toast";

import { ThreadActionSheet } from "./thread-action-sheet";

type ThreadRowProps = {
  category: MailCategory;
  entry: ThreadListEntry;
  mailboxId: string;
  onPress: () => void;
};

export const ThreadRow = ({
  category,
  entry,
  mailboxId,
  onPress,
}: ThreadRowProps) => {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const isUnread = entry.unreadCount > 0;
  const participants = entry.participants
    .map((participant) => participant.label)
    .slice(0, 3)
    .join(", ");
  const participantCount = entry.participants.length;

  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- `onSuccess` invalidates the mailbox cache through the shared `api.invalidate.mail` helper.
  const action = useMutation({
    mutationFn: async (kind: "archive" | "read" | "trash" | "unread") => {
      if (kind === "trash") {
        return await api.client.mail.moveThreadToTrash({
          mailboxId,
          threadId: entry.threadId,
        });
      }
      if (kind === "archive") {
        return await api.client.mail.applyChanges({
          command: { destination: "archive", kind: "move" },
          mailboxId,
          targets: [
            {
              messageIds: entry.messages.map((message) => message.id),
              threadId: entry.threadId,
            },
          ],
        });
      }
      if (kind === "read") {
        return await api.client.mail.markThreadAsRead({
          mailboxId,
          threadId: entry.threadId,
        });
      }
      return await api.client.mail.markThreadAsUnread({
        mailboxId,
        threadId: entry.threadId,
      });
    },
    onError: (error) => {
      toastError(error);
    },
    onSuccess: async () => {
      await api.invalidate.mail(queryClient, mailboxId);
    },
  });

  const [avatar] = entry.participants;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        className="flex-row gap-3 border-b border-border px-4 py-3 active:bg-control-hover"
        delayLongPress={250}
        onLongPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setIsActionsOpen(true);
        }}
        onPress={onPress}
      >
        <View className="pt-1.5">
          <View
            className={cn("size-2 rounded-full bg-transparent", {
              "bg-q-blue": isUnread,
            })}
          />
        </View>

        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <Text
              className={cn("min-w-0 flex-1", {
                "font-semibold": isUnread,
                "text-muted-fg": !isUnread,
              })}
              numberOfLines={1}
            >
              {participants}
              {participantCount > 3 ? ` +${participantCount - 3}` : ""}
            </Text>
            <Text className="text-caption text-muted-fg">
              {formatMessageListDate(entry.anchorMessage)}
            </Text>
          </View>
          <Text
            className={cn("text-body", {
              "font-medium": isUnread,
              "text-muted-fg": !isUnread,
            })}
            numberOfLines={1}
          >
            {entry.subject}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 text-body-sm text-muted-fg"
              numberOfLines={1}
            >
              {entry.preview}
            </Text>
            {entry.attachmentCount > 0 ? (
              <Icon className="text-muted-fg" icon={Archive02Icon} size={14} />
            ) : null}
            {entry.messageCount > 1 ? (
              <Text className="text-caption text-muted-fg">
                {entry.messageCount}
              </Text>
            ) : null}
          </View>
        </View>

        {avatar === undefined ? null : (
          <View className="size-9 items-center justify-center rounded-full bg-muted">
            <Text className="text-caption font-medium text-muted-fg">
              {avatar.fallbackLabel}
            </Text>
          </View>
        )}
      </Pressable>

      <ThreadActionSheet
        isArchived={category === "archive"}
        isUnread={isUnread}
        isVisible={isActionsOpen}
        onAction={(kind) => {
          action.mutate(kind);
        }}
        onClose={() => {
          setIsActionsOpen(false);
        }}
      />
    </>
  );
};
