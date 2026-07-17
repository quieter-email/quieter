import type { IconSvgElement } from "@hugeicons/react";
import {
  Archive02Icon,
  Calendar01Icon,
  Calendar03Icon,
  Delete01Icon,
  Delete02Icon,
  FileAttachmentIcon,
  FileEditIcon,
  Mail01Icon,
  MailAtSign01Icon,
  MailAtSign02Icon,
  MailOpen02Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import type { SearchFilterChip } from "~/features/message-search/state/message-list-search-state";

export const searchFilterOptions: ReadonlyArray<{
  filter: SearchFilterChip;
  hint: string;
  icon: IconSvgElement;
  label: string;
}> = [
  {
    filter: { type: "is", value: "unread" },
    hint: "is:unread",
    icon: MailAtSign01Icon,
    label: "Unread",
  },
  {
    filter: { type: "is", value: "read" },
    hint: "is:read",
    icon: MailOpen02Icon,
    label: "Read",
  },
  {
    filter: { type: "is", value: "archived" },
    hint: "is:archived",
    icon: Archive02Icon,
    label: "Archived",
  },
  {
    filter: { type: "is", value: "inbound" },
    hint: "is:inbound",
    icon: Mail01Icon,
    label: "Inbound",
  },
  {
    filter: { type: "is", value: "outbound" },
    hint: "is:outbound",
    icon: MailSend02Icon,
    label: "Outbound",
  },
  {
    filter: { type: "is", value: "spam" },
    hint: "is:spam",
    icon: Delete02Icon,
    label: "Spam",
  },
  {
    filter: { type: "is", value: "trash" },
    hint: "is:trash",
    icon: Delete01Icon,
    label: "Trash",
  },
  { filter: { type: "before", value: "" }, hint: "before:", icon: Calendar01Icon, label: "Before" },
  { filter: { type: "after", value: "" }, hint: "after:", icon: Calendar03Icon, label: "After" },
  {
    filter: { type: "older_than", value: "" },
    hint: "older_than:",
    icon: Calendar01Icon,
    label: "Older than",
  },
  {
    filter: { type: "newer_than", value: "" },
    hint: "newer_than:",
    icon: Calendar03Icon,
    label: "Newer than",
  },
  { filter: { type: "from", value: "" }, hint: "from:", icon: MailAtSign01Icon, label: "From" },
  { filter: { type: "to", value: "" }, hint: "to:", icon: MailAtSign02Icon, label: "To" },
  { filter: { type: "cc", value: "" }, hint: "cc:", icon: MailAtSign02Icon, label: "Cc" },
  { filter: { type: "bcc", value: "" }, hint: "bcc:", icon: MailAtSign02Icon, label: "Bcc" },
  {
    filter: { type: "subject", value: "" },
    hint: "subject:",
    icon: FileEditIcon,
    label: "Subject",
  },
  {
    filter: { type: "content", value: "" },
    hint: "content:",
    icon: FileEditIcon,
    label: "Content",
  },
  {
    filter: { type: "filename", value: "" },
    hint: "filename:",
    icon: FileEditIcon,
    label: "Filename",
  },
  {
    filter: { type: "has", value: "attachment" },
    hint: "has:attachment",
    icon: FileAttachmentIcon,
    label: "Has attachment",
  },
];
