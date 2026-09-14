import type { MessageListItem } from "@quieter/mail/messages";
import { formatMessageDate, parseSender } from "@quieter/mail/thread-list";
import { View } from "react-native";

import { Text } from "#/components/ui/text";

import { MessageBody } from "./message-body";

type MessageCardProps = {
  isLast: boolean;
  message: MessageListItem;
};

export const MessageCard = ({ isLast, message }: MessageCardProps) => {
  const sender = parseSender(message.from);
  const label = sender.name || sender.email || "Unknown sender";
  const recipients = message.to?.trim() ?? "";

  return (
    <View className="gap-3 p-4">
      <View className="flex-row items-start gap-3">
        <View className="size-9 items-center justify-center rounded-full bg-muted">
          <Text className="text-caption font-medium text-muted-fg">
            {(label.trim().charAt(0) || "?").toUpperCase()}
          </Text>
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="min-w-0 flex-1 font-medium" numberOfLines={1}>
              {label}
            </Text>
            <Text className="text-caption text-muted-fg">
              {formatMessageDate(message, "full")}
            </Text>
          </View>
          <Text className="text-caption text-muted-fg" numberOfLines={1}>
            {recipients.length > 0 ? `To: ${recipients}` : (sender.email ?? "")}
          </Text>
        </View>
      </View>

      <MessageBody bodyHtml={message.bodyHtml} bodyText={message.bodyText} />

      {isLast ? null : <View className="h-px bg-border" />}
    </View>
  );
};
