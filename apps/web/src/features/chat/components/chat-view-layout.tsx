"use client";

import { Button } from "@quieter/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { domMax, LayoutGroup, LazyMotion, m } from "motion/react";
import type { ComponentProps } from "react";

import { MobileHeader } from "#/components/mobile-header";
import { appEaseInOut, appMotionDuration } from "#/features/motion/app-motion";

import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

type ChatComposerProps = ComponentProps<typeof ChatComposer>;
type ChatTranscriptProps = ComponentProps<typeof ChatTranscript>;

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

const PlanRequiredBlock = ({
  organizationId,
  requirementLabel,
}: {
  organizationId: string;
  requirementLabel: string;
}) => {
  const navigate = useNavigate();

  return (
    <div className="mb-3 rounded-lg border border-border bg-secondary/35 p-3 text-body">
      <p className="font-medium text-fg">Upgrade required</p>
      <p className="mt-1 text-muted-fg">
        AI chat requires {requirementLabel} billing with available credits.
      </p>
      <Button
        className="mt-3"
        onClick={() => {
          void navigate({
            search: {
              organizationId,
              organizationView: "overview",
              tab: "organization",
            },
            to: "/settings",
          });
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        View plans
      </Button>
    </div>
  );
};

const ChatComposerPanel = ({
  canUseAiChat,
  isBillingPending,
  mailboxOrganizationId,
  requirementLabel,
  ...composerProps
}: ChatComposerProps & {
  canUseAiChat: boolean;
  isBillingPending: boolean;
  mailboxOrganizationId: string;
  requirementLabel: string;
}) => (
  <>
    {!canUseAiChat && !isBillingPending ? (
      <PlanRequiredBlock
        organizationId={mailboxOrganizationId}
        requirementLabel={requirementLabel}
      />
    ) : null}
    <ChatComposer {...composerProps} />
  </>
);

const chatExamplePrompts = [
  "Summarize what's unread",
  "Draft a reply to the latest message",
];

export const ChatViewLayout = ({
  chatId,
  chatTitle,
  composer,
  draftChatKey,
  hasMessages,
  onOpenSidebar,
  shouldReduceMotion,
  transcript,
}: {
  chatId: string | null;
  chatTitle: string | null | undefined;
  composer: ChatComposerProps & {
    canUseAiChat: boolean;
    isBillingPending: boolean;
    mailboxOrganizationId: string;
    requirementLabel: string;
  };
  draftChatKey: string;
  hasMessages: boolean;
  onOpenSidebar: () => void;
  shouldReduceMotion: boolean | null;
  transcript: ChatTranscriptProps;
}) => (
  <LazyMotion features={domMax}>
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MobileHeader
        leading="sidebar"
        onLeadingClick={onOpenSidebar}
        title={hasMessages && hasText(chatTitle) ? chatTitle : undefined}
      />
      {hasMessages && hasText(chatTitle) ? (
        <header className="hidden shrink-0 items-center border-b border-border px-4 py-3 lg:flex">
          <h1 className="truncate text-body font-medium tracking-tight text-fg">
            {chatTitle}
          </h1>
        </header>
      ) : null}
      <LayoutGroup id={chatId ?? draftChatKey}>
        <div className="flex min-h-0 flex-1 flex-col">
          {hasMessages ? (
            <>
              <ChatTranscript {...transcript} />
              <div className="w-full px-4 pb-5">
                <m.div
                  className="mx-auto w-full max-w-2xl"
                  layoutDependency={hasMessages}
                  layoutId="chat-composer"
                  transition={{
                    duration:
                      shouldReduceMotion === true
                        ? 0
                        : appMotionDuration.layout,
                    ease: appEaseInOut,
                  }}
                >
                  <ChatComposerPanel {...composer} />
                </m.div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4">
              <p className="text-title-sm tracking-tight text-fg">
                Ask about your mail
              </p>
              <m.div
                className="w-full max-w-xl"
                layoutDependency={hasMessages}
                layoutId="chat-composer"
                transition={{
                  duration:
                    shouldReduceMotion === true ? 0 : appMotionDuration.layout,
                  ease: appEaseInOut,
                }}
              >
                <ChatComposerPanel {...composer} />
              </m.div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {chatExamplePrompts.map((prompt) => (
                  <Button
                    key={prompt}
                    onClick={() => {
                      composer.onInputChange(prompt);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </LayoutGroup>
    </section>
  </LazyMotion>
);
