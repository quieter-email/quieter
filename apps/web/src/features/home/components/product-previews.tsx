"use client";

import {
  AiMicIcon,
  ArrowRight01Icon,
  Delete02Icon,
  Mail01Icon,
  MoreHorizontalIcon,
  PinIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brand } from "@quieter/ui/brand";
import { cn } from "@quieter/ui/cn";
import {
  ComposerEditorFrame,
  ComposerFieldGroup,
} from "@quieter/ui/composer-chrome";

import { Reveal } from "./reveal";

const mailboxes = [
  {
    address: "alex@example.com",
    name: "Personal",
    selected: true,
    status: null,
    unread: "5",
  },
  {
    address: "hello@studio.example",
    name: "Hello",
    selected: false,
    status: "Shared",
    unread: "3",
  },
  {
    address: "app@studio.example",
    name: "App",
    selected: false,
    status: "Send only",
    unread: null,
  },
] as const;

export const MailboxSwitcherPreview = () => (
  <div aria-hidden="true" className="home-panel home-connect-art" inert>
    <svg
      aria-hidden="true"
      className="home-connect-paths"
      viewBox="0 0 316 204"
    >
      <path
        className="home-connect-path"
        d="M0 16h70c52 0 45 86 96 86h150M0 102h316M0 188h70c52 0 45-86 96-86h150"
        fill="none"
      />
      <path
        className="home-connect-path-active"
        d="M0 16h70c52 0 45 86 96 86h150"
        fill="none"
        strokeWidth="1.5"
      />
      <circle className="home-connect-dot" cx="311" cy="102" r="3" />
    </svg>
    <div className="home-connect-sources">
      <div className="home-connect-source">
        <svg
          aria-hidden="true"
          className="home-source-mail"
          viewBox="0 0 24 24"
        >
          <path
            d="M3 5h18v14H3zM3 5l9 8 9-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span>Gmail</span>
      </div>
      <div className="home-connect-source">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            fill="none"
            r="9"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M3 12h18M12 3c6 5 6 13 0 18-6-5-6-13 0-18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span>Your domain</span>
      </div>
      <div className="home-connect-source">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span>API &amp; MCP</span>
      </div>
    </div>
    <div className="home-mailbox-switcher">
      <div className="home-mailbox-trigger">
        <p>Personal</p>
        <span>alex@example.com</span>
      </div>
      <div className="home-component-surface home-mailbox-menu">
        {mailboxes.map((mailbox) => (
          <div key={mailbox.address}>
            {mailbox.name === "App" ? null : (
              <div className="home-mailbox-group">
                <span className="home-chevron" />
                {mailbox.selected ? "Personal" : "Studio"}
              </div>
            )}
            <div
              className={cn("home-mailbox-row", {
                "home-selected-surface": mailbox.selected,
              })}
            >
              <div className="home-mailbox-summary">
                <p>{mailbox.name}</p>
                <span>{mailbox.address}</span>
              </div>
              {mailbox.status === null ? null : (
                <span className="home-mailbox-status">{mailbox.status}</span>
              )}
              {mailbox.unread === null ? null : (
                <span className="home-mailbox-unread">{mailbox.unread}</span>
              )}
              <span className="home-mailbox-pin">
                {mailbox.selected ? (
                  <HugeiconsIcon icon={PinIcon} size={14} />
                ) : null}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const messages = [
  {
    initials: "AM",
    label: "Projects",
    sender: "Alex Morgan",
    subject: "A few thoughts on the proposal",
    tone: "home-label-blue",
  },
  {
    initials: "S",
    label: "Receipts",
    sender: "Stripe",
    subject: "Your monthly invoice",
    tone: "home-label-gold",
  },
  {
    initials: "LR",
    label: "Personal",
    sender: "Leander",
    subject: "Photos from Tokyo",
    tone: "home-label-cyan",
  },
] as const;

export const LabelsPreview = () => (
  <div aria-hidden="true" className="home-panel home-labels-art" inert>
    <div className="home-label-rows">
      {messages.map((message) => (
        <div className="home-label-row" key={message.sender}>
          <span className="home-mail-avatar">{message.initials}</span>
          <div className="home-label-copy">
            <p>{message.sender}</p>
            <span>{message.subject}</span>
          </div>
          <div className="home-label-slot">
            <span className={cn("home-mail-label", message.tone)}>
              {message.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const highlights = [
  {
    description: "Alex is ready. Send a timeline by Friday.",
    title: "The proposal is approved",
    tone: "home-brief-blue",
  },
  {
    description: "Flights and hotel details are in your inbox.",
    title: "Your trip is confirmed",
    tone: "home-brief-cyan",
  },
  {
    description: "A quick reply is all that is left.",
    title: "Coffee with Sam",
    tone: "home-brief-gold",
  },
] as const;

export const BriefPreview = () => (
  <div
    aria-hidden="true"
    className="home-panel home-panel-raised home-brief-art"
    inert
  >
    <div className="home-brief-toolbar">
      <span>
        <Brand className="size-[18px]" />
        Your daily brief
      </span>
      <span className="home-brief-date">Tuesday, 8 September</span>
    </div>
    <p className="home-brief-greeting">Good morning, Leander.</p>
    <div className="home-brief-items">
      {highlights.map((highlight) => (
        <div className="home-brief-item" key={highlight.title}>
          <span className={cn("home-brief-dot", highlight.tone)} />
          <div>
            <p>{highlight.title}</p>
            <span>{highlight.description}</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const ComposePreview = () => (
  <div
    aria-hidden="true"
    className="home-panel home-panel-raised home-compose-art"
    inert
  >
    <ComposerEditorFrame className="home-component-surface home-composer-frame">
      <ComposerFieldGroup className="home-composer-fields">
        <div className="home-composer-to">
          <span>To</span>
          <span>alex@example.com</span>
        </div>
      </ComposerFieldGroup>
      <div className="home-composer-body">
        <p>Hey Alex,</p>
        <p>
          Glad you like the direction. I&apos;ll send the timeline by Friday.
        </p>
        <p>Tuesday afternoon works for me.</p>
      </div>
      <div className="home-composer-toolbar">
        <span className="home-composer-send">
          Send <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </span>
        <div className="home-composer-actions">
          <HugeiconsIcon icon={AiMicIcon} size={16} />
          <HugeiconsIcon icon={Delete02Icon} size={16} />
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
        </div>
      </div>
    </ComposerEditorFrame>
  </div>
);

export const AssistantPreview = () => (
  <div aria-hidden="true" className="home-panel home-chat-art" inert>
    <div className="home-chat-conversation">
      <p className="home-chat-question">
        What did Alex say about the proposal?
      </p>
      <p className="home-chat-answer">
        Alex approved the direction and asked for a timeline by Friday. He would
        like to go through it together next week.
      </p>
      <div className="home-chat-source">
        <HugeiconsIcon icon={Mail01Icon} size={16} />
        <span>A few thoughts on the proposal</span>
        <span className="home-source-separator" />
        <span className="home-chat-source-author">Alex Morgan</span>
      </div>
    </div>
  </div>
);

const TemplatesPreview = () => (
  <div className="home-component-surface home-template-picker">
    <div className="home-template-header">
      <p>Insert a template</p>
      <div className="home-template-search">
        <HugeiconsIcon icon={Search01Icon} size={14} />
        <span>Search</span>
      </div>
    </div>
    <div className="home-template-options">
      <p className="home-selected-surface">Thanks for reaching out</p>
      <p>A quick follow-up</p>
    </div>
  </div>
);

const DevicesPreview = () => (
  <div className="home-devices">
    <div className="home-device-desktop">
      <div className="home-device-label">
        <span />
        Personal
      </div>
      <div className="home-device-content">
        <div className="home-device-sidebar" />
        <div className="home-device-lines">
          {["inbox", "projects", "personal"].map((line) => (
            <span key={line} />
          ))}
        </div>
      </div>
    </div>
    <div className="home-device-phone">
      {["inbox", "projects", "personal"].map((line) => (
        <span key={line} />
      ))}
    </div>
  </div>
);

export const WorkflowPreview = () => (
  <div className="home-workflow-grid">
    <Reveal className="home-workflow-backdrop" delay={0.2} />
    <div className="home-workflow-feature">
      <Reveal delay={0.24}>
        <div
          aria-hidden="true"
          className="home-workflow-art home-keyboard-art"
          inert
        >
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </div>
      </Reveal>
      <Reveal className="home-workflow-caption" delay={0.4}>
        <h3>Keyboard shortcuts</h3>
        <p>
          Search, compose, and move through your inbox with intuitive shortcuts.
        </p>
      </Reveal>
    </div>
    <div className="home-workflow-feature">
      <Reveal delay={0.4}>
        <div aria-hidden="true" className="home-workflow-art" inert>
          <TemplatesPreview />
        </div>
      </Reveal>
      <Reveal className="home-workflow-caption" delay={0.56}>
        <h3>Reusable templates</h3>
        <p>
          Save the replies you use often.
          <br />
          Keep the personal touch.
        </p>
      </Reveal>
    </div>
    <div className="home-workflow-feature">
      <Reveal delay={0.56}>
        <div aria-hidden="true" className="home-workflow-art" inert>
          <DevicesPreview />
        </div>
      </Reveal>
      <Reveal className="home-workflow-caption" delay={0.72}>
        <h3>Desktop and mobile</h3>
        <p>
          Keep work and life neatly separate.
          <br />
          Pick up on your computer or phone.
        </p>
      </Reveal>
    </div>
  </div>
);
