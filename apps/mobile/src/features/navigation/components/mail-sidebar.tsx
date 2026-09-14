import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import type { MailCategory } from "@quieter/mail/data-plane";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { serializeStructuredSearchState } from "@quieter/mail/search";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";

import { Button } from "#/components/ui/button";
import { Icon } from "#/components/ui/icon";
import type { IconSvgElement } from "#/components/ui/icon";
import { Text } from "#/components/ui/text";
import {
  setDrawerOpen,
  setMailboxCategory,
  setSearchQuery,
  setSelectedMailboxId,
  useMailboxCategory,
  useSelectedMailboxId,
} from "#/features/workspace/workspace-store";
import { authClient } from "#/lib/auth-client";
import { api } from "#/lib/orpc";

import { MailboxSwitcher } from "./mailbox-switcher";
import { SidebarNavItem } from "./sidebar-nav-item";

const mailboxItems: readonly {
  icon: IconSvgElement;
  id: MailCategory;
  label: string;
}[] = [
  { icon: InboxIcon, id: "inbox", label: "Inbox" },
  { icon: Mail01Icon, id: "unread", label: "Unread" },
  { icon: Archive02Icon, id: "archive", label: "Archive" },
  { icon: MailSend02Icon, id: "sent", label: "Sent" },
  { icon: Edit01Icon, id: "drafts", label: "Drafts" },
  { icon: Delete01Icon, id: "trash", label: "Trash" },
  { icon: Delete02Icon, id: "spam", label: "Spam" },
];

const labelColorClasses: Record<string, string> = {
  blue: "bg-q-blue",
  cyan: "bg-q-cyan",
  gray: "bg-q-gray",
  green: "bg-q-green",
  orange: "bg-q-orange",
  pink: "bg-q-pink",
  purple: "bg-q-purple",
  red: "bg-q-red",
  yellow: "bg-q-yellow",
};

const getUserLabels = (labels: MailboxLabel[]) =>
  labels
    .filter((label) => label.type === "user" && label.visible)
    .toSorted((first, second) => first.position - second.position);

export const MailSidebar = ({ onClose }: { onClose: () => void }) => {
  const router = useRouter();
  const mailboxId = useSelectedMailboxId();
  const category = useMailboxCategory();
  const mailboxesQuery = useQuery(api.mailboxes.list());
  const labelsQuery = useQuery({
    ...api.mail.labels(mailboxId ?? ""),
    enabled: mailboxId !== null,
  });

  const groups = mailboxesQuery.data?.groups ?? [];
  const selectedMailbox = groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === mailboxId);
  const unreadCount = selectedMailbox?.unreadNonSpamCount ?? 0;
  const isApiMailbox = selectedMailbox?.provider === "api";
  const visibleItems = isApiMailbox
    ? mailboxItems.filter((item) => item.id === "sent")
    : mailboxItems;
  const labels = getUserLabels(labelsQuery.data ?? []);

  const goToMailbox = (nextCategory: MailCategory) => {
    setMailboxCategory(nextCategory);
    setSearchQuery("");
    setDrawerOpen(false);
    onClose();
    router.navigate("/");
  };

  const openLabel = (label: MailboxLabel) => {
    setMailboxCategory("inbox");
    setSearchQuery(
      serializeStructuredSearchState({
        filters: [{ type: "label", value: label.name }],
        text: "",
      })
    );
    setDrawerOpen(false);
    onClose();
    router.navigate("/");
  };

  return (
    <View className="flex-1">
      <View className="gap-3 px-3 pt-3">
        <MailboxSwitcher
          groups={groups}
          onSelect={(nextMailboxId) => {
            setSelectedMailboxId(nextMailboxId);
            onClose();
            router.navigate("/");
          }}
          selectedMailboxId={mailboxId}
        />
        <Button
          className="w-full justify-start"
          disabled={mailboxId === null || isApiMailbox}
          onPress={() => {
            setDrawerOpen(false);
            onClose();
            router.push("/compose");
          }}
        >
          <Icon icon={Edit01Icon} size={16} />
          <Text className="text-primary-fg">Compose</Text>
        </Button>
      </View>

      <ScrollView className="mt-2 flex-1 px-1">
        <View className="gap-0.5">
          {visibleItems.map((item) => (
            <SidebarNavItem
              active={category === item.id}
              badge={
                item.id === "inbox" && unreadCount > 0
                  ? String(unreadCount)
                  : undefined
              }
              key={item.id}
              onPress={() => {
                void Haptics.selectionAsync();
                goToMailbox(item.id);
              }}
            >
              <Icon
                className={category === item.id ? "text-fg" : "text-muted-fg"}
                icon={item.icon}
                size={16}
              />
              <Text
                className={category === item.id ? "text-fg" : "text-muted-fg"}
              >
                {item.label}
              </Text>
            </SidebarNavItem>
          ))}
        </View>

        {labels.length === 0 ? null : (
          <View className="mt-4 gap-0.5">
            <Text className="px-3 py-1 text-caption font-medium text-muted-fg">
              Labels
            </Text>
            {labels.map((label) => (
              <SidebarNavItem
                key={label.id}
                onPress={() => {
                  openLabel(label);
                }}
              >
                <View
                  className={
                    labelColorClasses[label.color ?? "gray"] ?? "bg-q-gray"
                  }
                  style={{ borderRadius: 3, height: 12, width: 12 }}
                />
                <Text className="text-muted-fg" numberOfLines={1}>
                  {label.name}
                </Text>
              </SidebarNavItem>
            ))}
          </View>
        )}
      </ScrollView>

      <View className="border-t border-border p-2">
        <SidebarNavItem
          onPress={() => {
            setDrawerOpen(false);
            onClose();
            router.push("/settings");
          }}
        >
          <Icon className="text-muted-fg" icon={Settings01Icon} size={16} />
          <Text className="text-muted-fg">Settings</Text>
        </SidebarNavItem>
        <SidebarNavItem
          onPress={() => {
            void authClient.signOut();
          }}
        >
          <Text className="text-muted-fg">Sign out</Text>
        </SidebarNavItem>
      </View>
    </View>
  );
};
