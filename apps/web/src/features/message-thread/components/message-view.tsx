"use client";

import {
  ArrowLeft01Icon,
  ArrowRightDoubleIcon,
  Edit01Icon,
  Loading03Icon,
  MailReply02Icon,
  MailReplyAll02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import {
  AnimatePresence,
  LayoutGroup,
  LazyMotion,
  domMax,
  m,
} from "motion/react";
import { lazy, Suspense, useRef, useState } from "react";

import {
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "#/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { MessageLabels } from "#/features/message-labels/components/message-labels";
import { parseSender } from "#/lib/gmail/message-utils";

import { createMailboxThreadMessageActionHandlers } from "./message-action-handlers";
import { MessageActionsDropdown } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { SingleMessageCard, ThreadMessageList } from "./message-cards";
import type { MessageViewProps } from "./message-view-types";
import {
  useMessageViewData,
  useMessageViewFocus,
  useMessageViewHotkeys,
} from "./use-message-view";

const InlineComposeSurface = lazy(
  async () =>
    await import("#/features/compose/components/compose-workspace").then(
      ({ ComposeSurface: Component }) => ({ default: Component })
    )
);

const inlineComposeTransition = {
  damping: 34,
  mass: 0.7,
  stiffness: 420,
  type: "spring",
} as const;

type MessageViewContentProps = MessageViewProps &
  ReturnType<typeof useMessageViewData> & {
    viewRef: ReturnType<typeof useMessageViewFocus>;
  };

const MessageViewContent = (props: MessageViewContentProps) => {
  const {
    activeMailbox,
    apiSource,
    apiSourceAction,
    canComposeFromMailbox,
    composeDemoMode,
    composeManagedDemoMode,
    composePersistDrafts,
    composeSignature,
    currentUserEmail,
    gmailLabels,
    hotkeyLinkedDraftMessage,
    hotkeyMessage,
    isActionPending,
    isBodyRefreshPending,
    isSingleMessageThread,
    mailboxActions,
    mailboxId,
    mailboxProvider,
    message,
    onBackToList,
    onManageTemplates,
    subject,
    threadAttachments,
    threadIsUnread,
    threadLabelIds,
    threadMessages,
    usefulDetails,
    viewRef,
    visibleMessages,
  } = props;
  const [inlineDraft, setInlineDraft] = useState<ComposeDraftState | null>(
    null
  );
  const inlineComposerRef = useRef<HTMLDivElement | null>(null);
  const openInlineCompose = (draft: ComposeDraftState) => {
    setInlineDraft((current) => current ?? draft);
    requestAnimationFrame(() => {
      inlineComposerRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    });
  };
  const replyTarget = parseSender(hotkeyMessage.from);
  const replyTargetLabel =
    replyTarget.name?.trim() ||
    replyTarget.display?.trim() ||
    replyTarget.email?.trim() ||
    "sender";
  const showInlineCompose = canComposeFromMailbox && activeMailbox !== "drafts";
  const showReplyAll = hasDistinctReplyAllRecipients(
    hotkeyMessage,
    currentUserEmail
  );

  useMessageViewHotkeys({
    activeMailbox,
    canComposeFromMailbox,
    currentUserEmail,
    hotkeyLinkedDraftMessage,
    hotkeyMessage,
    isActionPending,
    mailboxActions,
    mailboxProvider,
    onBackToList,
    onComposeDraftRequested: openInlineCompose,
  });

  return (
    <article ref={viewRef} tabIndex={-1} className="@container w-full">
      <header className="w-full border-b p-3 @sm:px-5 @sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBackToList ? (
            <Button
              aria-label="Back to list"
              className="shrink-0 lg:hidden"
              onClick={onBackToList}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
            </Button>
          ) : null}
          <h1 className="min-w-0 flex-1 truncate font-serif text-body-lg leading-[22px] font-normal tracking-[-0.01em] text-fg">
            {subject}
          </h1>
          {!isSingleMessageThread && (
            <p className="shrink-0 text-caption text-muted-fg">
              {visibleMessages.length}{" "}
              {visibleMessages.length === 1 ? "message" : "messages"}
            </p>
          )}
          <MessageLabels
            className="shrink-0"
            labelIds={threadLabelIds}
            labels={gmailLabels}
          />
          {mailboxProvider !== "api" && (
            <div className="shrink-0">
              <MessageActionsDropdown
                actions={createMailboxThreadMessageActionHandlers({
                  mailboxActions,
                  supportsFolders: mailboxProvider === "gmail",
                  supportsLabels: true,
                  supportsUnsubscribe: mailboxProvider === "gmail",
                })}
                isPending={isActionPending}
                isUnread={threadIsUnread}
                mailbox={activeMailbox}
                mailboxId={mailboxId}
                message={message}
                threadLabelIds={threadLabelIds}
              />
            </div>
          )}
        </div>

        {apiSource !== null && apiSource !== undefined && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-caption">
            <span className="text-muted-fg">
              Sent through API from {apiSource.senderAddress}.
            </span>
            {apiSourceAction}
          </div>
        )}

        <MessageAttachments
          attachments={threadAttachments}
          className="mt-3"
          mailboxId={mailboxId}
        />
      </header>

      {isSingleMessageThread ? (
        visibleMessages.map((threadMessage) => (
          <SingleMessageCard
            isLoading={isBodyRefreshPending}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={findLinkedDraftForMessage(
              threadMessages,
              threadMessage
            )}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            message={threadMessage}
            onComposeDraftRequested={
              canComposeFromMailbox ? openInlineCompose : undefined
            }
            onUnsubscribe={
              mailboxProvider === "gmail"
                ? mailboxActions.unsubscribeFromMessage
                : undefined
            }
            usefulDetails={usefulDetails.filter(
              (detail) => detail.gmailMessageId === threadMessage.id
            )}
          />
        ))
      ) : (
        <ThreadMessageList
          allThreadMessages={threadMessages}
          isLoading={isBodyRefreshPending}
          isActionPending={isActionPending}
          key={message.threadId}
          mailboxId={mailboxId}
          mailboxProvider={mailboxProvider}
          messages={visibleMessages}
          onComposeDraftRequested={
            canComposeFromMailbox ? openInlineCompose : undefined
          }
          onUnsubscribe={
            mailboxProvider === "gmail"
              ? mailboxActions.unsubscribeFromMessage
              : undefined
          }
          usefulDetails={usefulDetails}
        />
      )}

      {showInlineCompose ? (
        <div className="border-t px-4 py-4 @sm:px-5 @sm:py-5">
          <LazyMotion features={domMax}>
            <LayoutGroup id="inline-compose">
              <AnimatePresence initial={false} mode="popLayout">
                {inlineDraft ? (
                  <m.div
                    animate={{ opacity: 1 }}
                    data-inline-compose-host
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key="inline-compose"
                    layout
                    layoutId="inline-compose"
                    ref={inlineComposerRef}
                    transition={inlineComposeTransition}
                  >
                    <Suspense
                      fallback={
                        <output
                          aria-label="Loading inline composer"
                          aria-live="polite"
                          className="grid min-h-64 place-items-center rounded-xl border border-border bg-control text-body text-muted-fg"
                        >
                          <HugeiconsIcon
                            aria-hidden
                            className="size-5 animate-spin"
                            icon={Loading03Icon}
                          />
                        </output>
                      }
                    >
                      <InlineComposeSurface
                        demoMode={composeDemoMode}
                        initialDraft={inlineDraft}
                        key={inlineDraft.localId}
                        mailboxId={mailboxId}
                        managedDemoMode={composeManagedDemoMode}
                        onClose={() => {
                          setInlineDraft(null);
                        }}
                        onManageTemplates={onManageTemplates}
                        persistDrafts={composePersistDrafts}
                        senderEmail={currentUserEmail}
                        signature={composeSignature}
                        variant="inline"
                      />
                    </Suspense>
                  </m.div>
                ) : (
                  <m.div
                    animate={{ opacity: 1 }}
                    className="squircle flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-border bg-control p-1.5"
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key="inline-reply-bar"
                    layout
                    layoutId="inline-compose"
                    transition={inlineComposeTransition}
                  >
                    <Button
                      className="min-w-44 flex-1 justify-start px-3 text-muted-fg hover:text-fg"
                      onClick={() => {
                        openInlineCompose(
                          hotkeyLinkedDraftMessage
                            ? buildComposeDraftFromSavedDraftMessage(
                                hotkeyLinkedDraftMessage
                              )
                            : buildComposeDraftFromMessageAction({
                                action: "reply",
                                currentUserEmail,
                                existingDraftMessage: hotkeyLinkedDraftMessage,
                                message: hotkeyMessage,
                              })
                        );
                      }}
                      type="button"
                      variant="ghost"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        icon={
                          hotkeyLinkedDraftMessage
                            ? Edit01Icon
                            : MailReply02Icon
                        }
                      />
                      {hotkeyLinkedDraftMessage
                        ? "Continue draft"
                        : `Reply to ${replyTargetLabel}`}
                    </Button>
                    {showReplyAll ? (
                      <Button
                        aria-label="Reply all"
                        onClick={() => {
                          openInlineCompose(
                            buildComposeDraftFromMessageAction({
                              action: "reply-all",
                              currentUserEmail,
                              existingDraftMessage: hotkeyLinkedDraftMessage,
                              message: hotkeyMessage,
                            })
                          );
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon aria-hidden icon={MailReplyAll02Icon} />
                        <span className="hidden @sm:inline">Reply all</span>
                      </Button>
                    ) : null}
                    <Button
                      aria-label="Forward"
                      onClick={() => {
                        openInlineCompose(
                          buildComposeDraftFromMessageAction({
                            action: "forward",
                            currentUserEmail,
                            existingDraftMessage: null,
                            message: hotkeyMessage,
                          })
                        );
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <HugeiconsIcon aria-hidden icon={ArrowRightDoubleIcon} />
                      <span className="hidden @sm:inline">Forward</span>
                    </Button>
                  </m.div>
                )}
              </AnimatePresence>
            </LayoutGroup>
          </LazyMotion>
        </div>
      ) : null}
    </article>
  );
};

export const MessageView = (props: MessageViewProps) => {
  const data = useMessageViewData({
    mailboxId: props.mailboxId,
    mailboxProvider: props.mailboxProvider,
    message: props.message,
    pendingActions: props.pendingActions,
  });
  const viewRef = useMessageViewFocus({
    focusOnOpen: props.focusOnOpen,
    onAutoFocusComplete: props.onAutoFocusComplete,
  });

  return <MessageViewContent {...props} {...data} viewRef={viewRef} />;
};
