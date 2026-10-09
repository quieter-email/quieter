"use client";

import {
  ArrowLeft01Icon,
  ArrowRightDoubleIcon,
  Edit01Icon,
  Loading03Icon,
  MailReply02Icon,
  MailReplyAll02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domMax, m } from "motion/react";
import { lazy, Suspense, useRef, useState } from "react";

import {
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "#/features/compose/domain/compose-actions";
import { textToComposeBodyHtml } from "#/features/compose/domain/draft";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { MessageLabels } from "#/features/message-labels/components/message-labels";
import { toastError } from "#/lib/error-toast";
import { parseSender } from "#/lib/gmail/message-utils";
import { MAILBOX_LABELS } from "#/lib/mail";
import { getThreadWithDetailsOptions } from "#/lib/mail/thread-query";
import { orpc } from "#/lib/orpc";

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

const inlineComposeFadeTransition = {
  duration: 0.12,
  ease: "easeOut",
} as const;

const INLINE_REPLY_BAR_HEIGHT = 48;

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
    verificationCodes,
    viewRef,
    visibleMessages,
  } = props;
  const [inlineDraft, setInlineDraft] = useState<ComposeDraftState | null>(
    null
  );
  const inlineComposerRef = useRef<HTMLDivElement | null>(null);
  const composeRevisionRef = useRef(0);
  const queryClient = useQueryClient();
  const openInlineCompose = (draft: ComposeDraftState) => {
    composeRevisionRef.current += 1;
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
  const suggestReply = useMutation(orpc.ai.suggestReply.mutationOptions());
  const requestSuggestedReply = () => {
    const composeRevision = composeRevisionRef.current;
    const draft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail,
      message: hotkeyMessage,
    });
    suggestReply.mutate(
      {
        mailboxId,
        messageId: hotkeyMessage.id,
        threadId: hotkeyMessage.threadId,
      },
      {
        onError: (error) => {
          toastError(error, {
            boundary: "suggest-reply",
            fallback: "Could not suggest a reply. Please try again.",
          });
        },
        onSuccess: (suggestion) => {
          const currentThread = queryClient.getQueryData(
            getThreadWithDetailsOptions(mailboxId, hotkeyMessage.threadId)
              .queryKey
          );
          const currentReplyTarget = currentThread?.messages.findLast(
            (entry) =>
              !entry.draftId?.trim() &&
              entry.labelIds?.includes(MAILBOX_LABELS.drafts) !== true
          );
          if (
            composeRevisionRef.current !== composeRevision ||
            (currentReplyTarget !== undefined &&
              currentReplyTarget.id !== hotkeyMessage.id) ||
            findLinkedDraftForMessage(
              currentThread?.messages ?? [],
              hotkeyMessage
            )
          ) {
            return;
          }
          if (suggestion.status === "not_needed") {
            toast.info(suggestion.reason);
            return;
          }
          openInlineCompose({
            ...draft,
            assistantUnsaved: true,
            bodyHtml: `${textToComposeBodyHtml(suggestion.bodyText)}${draft.bodyHtml}`,
            bodyText: `${suggestion.bodyText}\n\n${draft.bodyText}`,
          });
        },
      }
    );
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
          <h1
            // oxlint-disable-next-line shadcn/no-arbitrary-values -- Optical tracking for the thread subject.
            className="min-w-0 flex-1 truncate font-sans text-body-lg leading-5.5 font-normal tracking-[-0.01em] text-fg"
          >
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
                  onBackToList,
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
            verificationCode={
              verificationCodes.find(
                (item) => item.messageId === threadMessage.id
              )?.code
            }
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
          verificationCodes={verificationCodes}
        />
      )}

      {showInlineCompose ? (
        <div className="border-t px-4 py-4 @sm:px-5 @sm:py-5">
          <LazyMotion features={domMax}>
            <AnimatePresence initial={false} mode="popLayout">
              {inlineDraft ? (
                <m.div
                  animate={{ height: "auto", opacity: 1 }}
                  className="overflow-hidden"
                  data-inline-compose-host
                  exit={{ height: 0, opacity: 0 }}
                  initial={{ height: INLINE_REPLY_BAR_HEIGHT, opacity: 0 }}
                  key="inline-compose"
                  ref={inlineComposerRef}
                  transition={{
                    ...inlineComposeTransition,
                    opacity: inlineComposeFadeTransition,
                  }}
                >
                  {inlineDraft.assistantUnsaved === true ? (
                    <p className="mb-3 text-caption text-muted-fg">
                      Suggested reply. Review and edit before sending.
                    </p>
                  ) : null}
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
                  className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-border bg-control p-1.5 squircle"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  key="inline-reply-bar"
                  transition={inlineComposeFadeTransition}
                >
                  <Button
                    // oxlint-disable-next-line shadcn/no-restyle -- Inline reply bar keeps its input-like metrics.
                    className="min-w-44 flex-1 justify-start px-3"
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
                        hotkeyLinkedDraftMessage ? Edit01Icon : MailReply02Icon
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
                  {!hotkeyLinkedDraftMessage &&
                  composeDemoMode !== true &&
                  composeManagedDemoMode !== true ? (
                    <Button
                      disabled={
                        suggestReply.isPending ||
                        isBodyRefreshPending ||
                        isActionPending
                      }
                      onClick={requestSuggestedReply}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className={cn({
                          "animate-spin": suggestReply.isPending,
                        })}
                        icon={
                          suggestReply.isPending ? Loading03Icon : SparklesIcon
                        }
                      />
                      <span aria-live="polite">
                        {suggestReply.isPending
                          ? "Suggesting reply…"
                          : "Suggest reply"}
                      </span>
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

  return (
    <MessageViewContent
      {...props}
      {...data}
      key={`${props.mailboxId}:${props.message.threadId}`}
      viewRef={viewRef}
    />
  );
};
