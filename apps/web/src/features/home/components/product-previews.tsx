"use client";

import { Mail01Icon, PinIcon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { useId, useState } from "react";

import { previewMessages } from "./preview-data";
import type { PreviewMessage } from "./preview-data";
import { PreviewMessageDialog } from "./preview-message";

const mailboxes = [
  {
    address: "alex@example.com",
    icon: <path d="M3 5h18v14H3zM3 5l9 8 9-8" />,
    kind: "gmail",
    name: "Personal",
    source: "Gmail",
    status: null,
    unread: "5",
  },
  {
    address: "hello@studio.example",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c6 5 6 13 0 18-6-5-6-13 0-18" />
      </>
    ),
    kind: "domain",
    name: "Hello",
    source: "Your domain",
    status: "Shared",
    unread: "3",
  },
  {
    address: "app@studio.example",
    icon: <path d="m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18" />,
    kind: "api",
    name: "App",
    source: "API & MCP",
    status: "Send only",
    unread: null,
  },
] as const;

const paths = {
  api: "M0 188h70c52 0 45-86 96-86h150",
  domain: "M0 102h316",
  gmail: "M0 16h70c52 0 45 86 96 86h150",
} as const;

export const MailboxSwitcherPreview = () => {
  const [selected, setSelected] = useState<(typeof mailboxes)[number]>(
    mailboxes[0]
  );
  const [expanded, setExpanded] = useState(true);
  const menuId = useId();
  return (
    <div className="home-connect-art">
      <svg
        aria-hidden="true"
        className="home-connect-paths"
        preserveAspectRatio="none"
        viewBox="0 0 316 204"
      >
        <path
          className="home-connect-path"
          d="M0 16h70c52 0 45 86 96 86h150M0 102h316M0 188h70c52 0 45-86 96-86h150"
          fill="none"
        />
        <path
          className="home-connect-path-active"
          d={paths[selected.kind]}
          fill="none"
          strokeWidth="1.5"
        />
        <circle className="home-connect-dot" cx="311" cy="102" r="3" />
      </svg>
      <div className="home-connect-sources">
        {mailboxes.map((mailbox) => (
          <div className="home-connect-source" key={mailbox.kind}>
            <Button
              aria-pressed={selected.kind === mailbox.kind}
              className="lg:hidden"
              fullWidth
              onClick={() => {
                setSelected(mailbox);
                setExpanded(true);
              }}
              size="compact"
              variant="option"
            >
              {mailbox.source}
            </Button>
            <Button
              aria-pressed={selected.kind === mailbox.kind}
              className="hidden lg:inline-flex"
              fullWidth
              onClick={() => {
                setSelected(mailbox);
                setExpanded(true);
              }}
              size="lg"
              variant="ghost"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke={
                  selected.kind === mailbox.kind
                    ? "var(--q-blue)"
                    : "currentColor"
                }
                strokeWidth="1.5"
              >
                {mailbox.icon}
              </svg>
              {mailbox.source}
            </Button>
          </div>
        ))}
      </div>
      <div className="home-mailbox-switcher">
        <div className="home-mailbox-trigger">
          <Button
            aria-controls={menuId}
            aria-expanded={expanded}
            fullWidth
            onClick={() => {
              setExpanded(!expanded);
            }}
            size="auto"
            variant="secondary"
          >
            <span className="home-mailbox-summary">
              <Text as="span" size="sm" truncate weight="normal">
                {selected.name}
              </Text>
              <Text
                as="span"
                size="caption"
                tone="muted"
                truncate
                weight="normal"
              >
                {selected.address}
              </Text>
            </span>
          </Button>
        </div>
        <div
          className={cn("home-mailbox-menu", {
            "home-mailbox-menu-collapsed": !expanded,
          })}
          id={menuId}
        >
          <Surface padding="compact">
            <div className="flex flex-col gap-0.5">
              {mailboxes.map((mailbox) => (
                <div key={mailbox.address}>
                  {mailbox.kind === "api" ? null : (
                    <div className="home-mailbox-group">
                      <span className="home-chevron" />
                      {mailbox.kind === "gmail" ? "Personal" : "Studio"}
                    </div>
                  )}
                  <Button
                    aria-pressed={selected.kind === mailbox.kind}
                    fullWidth
                    onClick={() => {
                      setSelected(mailbox);
                    }}
                    size="auto"
                    variant="option"
                  >
                    <span className="home-mailbox-summary">
                      <Text as="span" size="sm" truncate weight="normal">
                        {mailbox.name}
                      </Text>
                      <Text
                        as="span"
                        size="caption"
                        tone="muted"
                        truncate
                        weight="normal"
                      >
                        {mailbox.address}
                      </Text>
                    </span>
                    {mailbox.status === null ? null : (
                      <Pill size="xs" tone="neutral">
                        {mailbox.status}
                      </Pill>
                    )}
                    {mailbox.unread === null ? null : (
                      <Pill size="xs" tone="neutral">
                        {mailbox.unread}
                      </Pill>
                    )}
                    <span className="home-mailbox-pin">
                      {selected.kind === mailbox.kind ? (
                        <Icon icon={PinIcon} size={14} />
                      ) : null}
                    </span>
                  </Button>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
};

const labelOptions = {
  personal: { label: "Personal", next: "projects", tone: "cyan" },
  projects: { label: "Projects", next: "receipts", tone: "blue" },
  receipts: { label: "Receipts", next: "personal", tone: "yellow" },
} as const;

const labelledMessages = [
  {
    initials: "AM",
    label: "projects",
    sender: "Alex Morgan",
    subject: "A few thoughts on the proposal",
  },
  {
    initials: "S",
    label: "receipts",
    sender: "Stripe",
    subject: "Your monthly invoice",
  },
  {
    initials: "LR",
    label: "personal",
    sender: "Leander",
    subject: "Photos from Tokyo",
  },
] as const;

const LabelledMessage = ({
  message,
}: {
  message: (typeof labelledMessages)[number];
}) => {
  const [choice, setChoice] = useState<keyof typeof labelOptions>(
    message.label
  );
  const label = labelOptions[choice];
  return (
    <div className="home-label-row">
      <SenderAvatar fallbackLabel={message.initials} />
      <div className="home-label-copy">
        <p>{message.sender}</p>
        <span>{message.subject}</span>
      </div>
      <div className="home-label-slot">
        <IconButtonTooltip label="Change label">
          <Button
            aria-label={`Change label for ${message.sender}, currently ${label.label}`}
            onClick={() => {
              setChoice(label.next);
            }}
            variant="inline-edit"
          >
            <Pill size="xs" tone={label.tone}>
              {label.label}
            </Pill>
          </Button>
        </IconButtonTooltip>
      </div>
    </div>
  );
};

export const LabelsPreview = () => (
  <Surface className="flex flex-col" padding="dense">
    {labelledMessages.map((message) => (
      <LabelledMessage key={message.sender} message={message} />
    ))}
  </Surface>
);

export const ImportantPreview = () => {
  const [selected, setSelected] = useState<PreviewMessage | null>(null);
  return (
    <>
      <Surface>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="home-important-greeting">
              Mail worth your attention.
            </p>
            <Text size="caption" tone="muted">
              {previewMessages.length} conversations
            </Text>
          </div>
          <div className="flex flex-col gap-1">
            {previewMessages.map((message) => (
              <Button
                aria-label={`Open sample email: ${message.subject}`}
                fullWidth
                key={message.id}
                onClick={() => {
                  setSelected(message);
                }}
                size="auto"
                variant="ghost"
              >
                <span aria-hidden className="home-important-dot" />
                <span className="flex min-w-0 flex-col gap-1">
                  <Text as="span" size="sm" weight="normal">
                    {message.title}
                  </Text>
                  <Text as="span" size="caption" tone="muted" weight="normal">
                    {message.summary}
                  </Text>
                </span>
              </Button>
            ))}
          </div>
        </div>
      </Surface>
      <PreviewMessageDialog
        message={selected}
        onClose={() => {
          setSelected(null);
        }}
      />
    </>
  );
};

export const AssistantPreview = () => {
  const [selected, setSelected] = useState<PreviewMessage | null>(null);
  return (
    <>
      <div className="home-chat-conversation">
        <Surface
          chrome="inset"
          className="max-w-65 self-end sm:max-w-87.5"
          variant="detail"
        >
          <p className="home-chat-question">
            What did Alex say about the proposal?
          </p>
        </Surface>
        <p className="home-chat-answer">
          Alex approved the direction and asked for a timeline by Friday. He
          would like to go through it together next week.
        </p>
        <Surface padding="none">
          <Button
            aria-label="Read source email from Alex Morgan"
            fullWidth
            onClick={() => {
              setSelected(previewMessages[0]);
            }}
            size="auto"
            variant="ghost"
          >
            <Icon icon={Mail01Icon} tone="muted" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <Text as="span" size="caption" weight="normal">
                A few thoughts on the proposal
              </Text>
              <Text as="span" size="caption" tone="muted" weight="normal">
                Alex Morgan
              </Text>
            </span>
          </Button>
        </Surface>
      </div>
      <PreviewMessageDialog
        message={selected}
        onClose={() => {
          setSelected(null);
        }}
      />
    </>
  );
};
