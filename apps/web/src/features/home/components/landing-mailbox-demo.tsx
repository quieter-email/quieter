"use client";

import { domAnimation, LazyMotion } from "motion/react";
import { useState } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { LandingMailboxMessagesPanel } from "~/features/home/components/landing-mailbox-messages-panel";
import { MailSidebar } from "~/features/navigation/components/mail-sidebar";
import { getLandingDemoMailboxes, LANDING_DEMO_MAILBOX_ID } from "~/lib/gmail/demo-mail";
import { type MailboxCategory } from "~/lib/gmail/gmail";

const landingMailboxData = getLandingDemoMailboxes();

export const LandingMailboxDemo = () => {
  const [activeMailbox, setActiveMailbox] = useState<MailboxCategory>("inbox");
  const [messageId, setMessageId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (mailbox === activeMailbox) return;
    setActiveMailbox(mailbox);
    setMessageId(null);
    setThreadId(null);
  };

  const applySearch = (query: string) => {
    const normalizedQuery = query.trim();

    if (normalizedQuery === searchQuery.trim()) {
      setMessageId(null);
      setThreadId(null);
      return;
    }

    setSearchQuery(normalizedQuery);
    setMessageId(null);
    setThreadId(null);
  };

  return (
    <LazyMotion features={domAnimation}>
      <div className="@container">
        <div className="relative isolate h-[min(58dvh,520px)] w-full overflow-hidden rounded-xl border border-white/10 bg-background-dark text-foreground shadow-[0_40px_100px_-20px_rgba(0,0,0,0.55),0_16px_40px_-12px_rgba(0,0,0,0.35)] ring-1 ring-black/10 squircle @3xl:h-[min(82dvh,880px)] @3xl:rounded-2xl">
          <WorkspaceDitherBackground />
          <div className="relative z-10 flex h-full min-h-0 overflow-hidden">
            <MailSidebar
              activeChatId={null}
              chats={[]}
              defaultMailboxId={landingMailboxData.defaultMailboxId}
              embedded
              groups={landingMailboxData.groups}
              isMobileOpen={isMobileSidebarOpen}
              onComposeNewMail={() => {}}
              onCreateChat={() => {}}
              onDeleteChat={() => {}}
              onMobileOpenChange={setIsMobileSidebarOpen}
              onReconnectMailbox={() => {}}
              onRenameChat={() => {}}
              onReorderMailboxSwitcher={() => {}}
              onSearch={applySearch}
              onSelectChat={() => {}}
              onSelectMailbox={selectMailbox}
              onSelectMailboxId={() => {}}
              onSelectView={() => {}}
              onSetDefaultMailbox={() => {}}
              reconnectingMailboxId={null}
              searchQuery={searchQuery}
              selectedMailbox={activeMailbox}
              selectedMailboxId={LANDING_DEMO_MAILBOX_ID}
              selectedMailboxProvider="gmail"
              selectedView="inbox"
            />

            <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
              <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden @5xl:grid @5xl:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] @5xl:grid-rows-[minmax(0,1fr)]">
                <LandingMailboxMessagesPanel
                  activeMailbox={activeMailbox}
                  messageId={messageId}
                  onMessageIdChange={(nextMessageId, nextThreadId) => {
                    setMessageId(nextMessageId);
                    setThreadId(nextThreadId);
                  }}
                  onOpenSidebar={() => setIsMobileSidebarOpen(true)}
                  onSearchQueryChange={setSearchQuery}
                  searchQuery={searchQuery}
                  threadId={threadId}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </LazyMotion>
  );
};
