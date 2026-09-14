import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { MobileHeader } from "#/components/mobile-header";
import { Button } from "#/components/ui/button";
import { Icon } from "#/components/ui/icon";
import { IconButton } from "#/components/ui/icon-button";
import { Surface } from "#/components/ui/surface";
import { ThreadActionSheet } from "#/features/message-list/components/thread-action-sheet";
import type { ThreadActionKind } from "#/features/message-list/components/thread-action-sheet";
import { useSelectedMailboxId } from "#/features/workspace/workspace-store";
import { api } from "#/lib/orpc";
import { queryClient } from "#/lib/query-client";
import { toastError } from "#/lib/toast";

import { MessageCard } from "./message-card";

export const ThreadScreen = ({ threadId }: { threadId: string }) => {
  const router = useRouter();
  const mailboxId = useSelectedMailboxId();
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const markedReadRef = useRef<string | null>(null);

  const threadQuery = useQuery({
    ...api.mail.thread({ mailboxId: mailboxId ?? "", threadId }),
    enabled: mailboxId !== null,
  });

  const currentMailboxId = mailboxId ?? "";
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- The shared invalidation helper runs in `onSuccess`.
  const markRead = useMutation({
    ...api.mail.mutations.markThreadAsRead,
    onSuccess: async () => {
      await api.invalidate.mail(queryClient, currentMailboxId);
    },
  });
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- The shared invalidation helper runs in `onSuccess`.
  const action = useMutation({
    mutationFn: async (kind: ThreadActionKind) => {
      if (kind === "trash") {
        return await api.client.mail.moveThreadToTrash({
          mailboxId: currentMailboxId,
          threadId,
        });
      }
      if (kind === "archive") {
        const messages = threadQuery.data?.messages ?? [];
        return await api.client.mail.applyChanges({
          command: { destination: "archive", kind: "move" },
          mailboxId: currentMailboxId,
          targets: [
            {
              messageIds: messages.map((message) => message.id),
              threadId,
            },
          ],
        });
      }
      if (kind === "read") {
        return await api.client.mail.markThreadAsRead({
          mailboxId: currentMailboxId,
          threadId,
        });
      }
      return await api.client.mail.markThreadAsUnread({
        mailboxId: currentMailboxId,
        threadId,
      });
    },
    onError: (error) => {
      toastError(error);
    },
    onSuccess: async (_, kind) => {
      if (
        kind === "trash" ||
        kind === "archive" ||
        kind === "read" ||
        kind === "unread"
      ) {
        await api.invalidate.mail(queryClient, currentMailboxId);
      }
      if (kind === "trash" || kind === "archive") {
        router.back();
      }
    },
  });

  const thread = threadQuery.data;
  const messages = thread?.messages ?? [];
  const subject = thread?.subject?.trim();

  const markThreadRead = useEffectEvent(() => {
    markRead.mutate({ mailboxId: mailboxId ?? "", threadId });
  });

  useEffect(() => {
    if (
      mailboxId === null ||
      thread === undefined ||
      thread.messages.length === 0 ||
      markedReadRef.current === threadId
    ) {
      return;
    }
    markedReadRef.current = threadId;
    if (thread.messages.some((message) => message.isUnread === true)) {
      markThreadRead();
    }
  }, [mailboxId, thread, threadId]);

  const openCompose = (mode: "forward" | "reply" | "reply-all") => {
    const lastMessage = messages.at(-1);
    router.push({
      params: {
        ...(lastMessage === undefined ? {} : { messageId: lastMessage.id }),
        mode,
        threadId,
      },
      pathname: "/compose",
    });
  };

  return (
    <View className="flex-1 bg-bg">
      <MobileHeader
        leading="back"
        onLeadingClick={() => {
          router.back();
        }}
        title={
          subject === undefined || subject === "" ? "(No subject)" : subject
        }
      >
        <IconButton
          label="Message actions"
          onPress={() => {
            setIsActionsOpen(true);
          }}
          size="sm"
        >
          <Icon icon={MoreHorizontalIcon} size={18} />
        </IconButton>
      </MobileHeader>

      {threadQuery.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="pb-4">
          <Surface className="m-1.5">
            {messages.map((message, index) => (
              <MessageCard
                isLast={index === messages.length - 1}
                key={message.id}
                message={message}
              />
            ))}
          </Surface>
        </ScrollView>
      )}

      {messages.length === 0 ? null : (
        <View className="flex-row gap-2 border-t border-border bg-bg px-2 py-2">
          <Button
            className="flex-1"
            onPress={() => {
              openCompose("reply");
            }}
            size="sm"
            variant="outline"
          >
            Reply
          </Button>
          <Button
            className="flex-1"
            onPress={() => {
              openCompose("reply-all");
            }}
            size="sm"
            variant="outline"
          >
            Reply all
          </Button>
          <Button
            className="flex-1"
            onPress={() => {
              openCompose("forward");
            }}
            size="sm"
            variant="outline"
          >
            Forward
          </Button>
        </View>
      )}

      <ThreadActionSheet
        isArchived={false}
        isUnread={messages.some((message) => message.isUnread === true)}
        isVisible={isActionsOpen}
        onAction={(kind) => {
          action.mutate(kind);
        }}
        onClose={() => {
          setIsActionsOpen(false);
        }}
      />
    </View>
  );
};
