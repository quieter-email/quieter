import {
  Archive02Icon,
  Delete01Icon,
  MailOpen01Icon,
  Mail01Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { Modal, Pressable, View } from "react-native";

import { Icon } from "#/components/ui/icon";
import type { IconSvgElement } from "#/components/ui/icon";
import { Text } from "#/components/ui/text";

export type ThreadActionKind = "archive" | "read" | "trash" | "unread";

type ThreadActionSheetProps = {
  isArchived: boolean;
  isUnread: boolean;
  isVisible: boolean;
  onAction: (kind: ThreadActionKind) => void;
  onClose: () => void;
};

export const ThreadActionSheet = ({
  isArchived,
  isUnread,
  isVisible,
  onAction,
  onClose,
}: ThreadActionSheetProps) => {
  const actions: {
    icon: IconSvgElement;
    kind: ThreadActionKind;
    label: string;
  }[] = [
    isUnread
      ? { icon: MailOpen01Icon, kind: "read", label: "Mark as read" }
      : { icon: Mail01Icon, kind: "unread", label: "Mark as unread" },
    isArchived
      ? { icon: Undo02Icon, kind: "archive", label: "Move to inbox" }
      : { icon: Archive02Icon, kind: "archive", label: "Archive" },
    { icon: Delete01Icon, kind: "trash", label: "Move to trash" },
  ];

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={isVisible}
    >
      <View className="flex-1 justify-end bg-bg/50">
        <Pressable
          accessibilityLabel="Close actions"
          className="flex-1"
          onPress={onClose}
        />
        <View className="rounded-t-2xl border border-border bg-bg-raised pb-6">
          <View className="items-center py-3">
            <View className="h-1 w-10 rounded-full bg-border-strong" />
          </View>
          {actions.map((action) => (
            <Pressable
              className="flex-row items-center gap-3 px-5 py-3.5 active:bg-control-hover"
              key={action.kind}
              onPress={() => {
                onClose();
                onAction(action.kind);
              }}
            >
              <Icon className="text-muted-fg" icon={action.icon} size={18} />
              <Text>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
};
