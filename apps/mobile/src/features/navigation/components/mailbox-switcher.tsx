import { Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { Icon } from "#/components/ui/icon";
import { Text } from "#/components/ui/text";
import { cn } from "#/lib/cn";

type SwitcherMailbox = {
  emailAddress: string;
  displayName: string | null;
  id: string;
  unreadNonSpamCount: number;
};

type SwitcherGroup = {
  id: string;
  name: string;
  mailboxes: SwitcherMailbox[];
};

type MailboxSwitcherProps = {
  groups: SwitcherGroup[];
  onSelect: (mailboxId: string) => void;
  selectedMailboxId: string | null;
};

export const MailboxSwitcher = ({
  groups,
  onSelect,
  selectedMailboxId,
}: MailboxSwitcherProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedMailbox = groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === selectedMailboxId);

  return (
    <>
      <Pressable
        accessibilityLabel="Switch mailbox"
        accessibilityRole="button"
        className="flex-row items-center gap-3 rounded-lg border border-border bg-bg-raised px-3 py-2.5 active:bg-control-hover"
        onPress={() => {
          setIsOpen(true);
        }}
      >
        <View className="min-w-0 flex-1">
          <Text className="font-medium" numberOfLines={1}>
            {selectedMailbox?.displayName ??
              selectedMailbox?.emailAddress ??
              "Mailbox"}
          </Text>
          <Text className="text-caption text-muted-fg" numberOfLines={1}>
            {selectedMailbox?.emailAddress ?? ""}
          </Text>
        </View>
        <Icon className="text-muted-fg" icon={UnfoldMoreIcon} size={16} />
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsOpen(false);
        }}
        transparent
        visible={isOpen}
      >
        <View className="flex-1 justify-end bg-bg/50">
          <Pressable
            accessibilityLabel="Close mailbox switcher"
            className="flex-1"
            onPress={() => {
              setIsOpen(false);
            }}
          />
          <View className="max-h-[70%] rounded-t-2xl border border-border bg-bg-raised pb-6">
            <View className="items-center py-3">
              <View className="h-1 w-10 rounded-full bg-border-strong" />
            </View>
            <ScrollView className="px-2">
              {groups.map((group) => (
                <View className="mb-2" key={group.id}>
                  <Text className="px-3 py-1 text-caption font-medium text-muted-fg">
                    {group.name}
                  </Text>
                  {group.mailboxes.map((mailbox) => {
                    const isSelected = mailbox.id === selectedMailboxId;
                    return (
                      <Pressable
                        className={cn(
                          "flex-row items-center gap-3 rounded-lg px-3 py-2.5 active:bg-control-hover",
                          { "bg-muted": isSelected }
                        )}
                        key={mailbox.id}
                        onPress={() => {
                          setIsOpen(false);
                          onSelect(mailbox.id);
                        }}
                      >
                        <View className="min-w-0 flex-1">
                          <Text className="font-medium" numberOfLines={1}>
                            {mailbox.displayName ?? mailbox.emailAddress}
                          </Text>
                          {mailbox.displayName === null ? null : (
                            <Text
                              className="text-caption text-muted-fg"
                              numberOfLines={1}
                            >
                              {mailbox.emailAddress}
                            </Text>
                          )}
                        </View>
                        {mailbox.unreadNonSpamCount > 0 ? (
                          <Text className="text-caption text-muted-fg">
                            {mailbox.unreadNonSpamCount}
                          </Text>
                        ) : null}
                        {isSelected ? (
                          <Icon
                            className="text-fg"
                            icon={Tick02Icon}
                            size={16}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};
