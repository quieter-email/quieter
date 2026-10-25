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
import { AssistantSidebarTrigger } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import {
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "@quieter/app/features/compose/domain/compose-actions";
import { textToComposeBodyHtml } from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { MessageLabels } from "@quieter/app/features/message-labels/components/message-labels";
import { createMailboxThreadMessageActionHandlers } from "@quieter/app/features/message-thread/components/message-action-handlers";
import { MessageActionsDropdown } from "@quieter/app/features/message-thread/components/message-actions";
import { MessageAttachments } from "@quieter/app/features/message-thread/components/message-attachments";
import {
  SingleMessageCard,
  ThreadMessageList,
} from "@quieter/app/features/message-thread/components/message-cards";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import { ThreadActionResults } from "@quieter/app/features/message-thread/components/thread-action-results";
import {
  useMessageViewData,
  useMessageViewFocus,
  useMessageViewHotkeys,
} from "@quieter/app/features/message-thread/components/use-message-view";
import { toastError } from "@quieter/app/lib/error-toast";
import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import { MAILBOX_LABELS } from "@quieter/app/lib/mail";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import { orpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  ComposerActionBar,
  ComposerEditorFrame,
} from "@quieter/ui/composer-chrome";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domMax, m } from "motion/react";
import { lazy, Suspense, useRef, useState } from "react";

const InlineComposeSurface = lazy(
  async () =>
    await import("@quieter/app/features/compose/components/compose-workspace").then(
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
    composeSenderMailbox,
    composeSignature,
    currentUserEmail,
    detailOnly = false,
    showDesktopBack = false,
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
    onManageSnippets,
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
  const [actionDraft, setActionDraft] = useState<ComposeDraftState | null>(
    null
  );
  const inlineComposerRef = useRef<HTMLDivElement | null>(null);
  const composeRevisionRef = useRef(0);
  const queryClient = useQueryClient();
  const openInlineCompose = (draft: ComposeDraftState) => {
    if (!draft.draftId && isBodyRefreshPending) {
      return;
    }
    composeRevisionRef.current += 1;
    if (inlineDraft) {
      setActionDraft(draft);
    } else {
      setInlineDraft(draft);
    }
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
  const setMessageImportance = mailboxActions.canSetImportance
    ? async (messageId: string, important: boolean) => {
        try {
          await mailboxActions.setMessageImportance(messageId, important);
        } catch (error) {
          toastError(error, { boundary: "message-importance" });
        }
      }
    : undefined;
  const showInlineCompose = canComposeFromMailbox && activeMailbox !== "drafts";
  const showReplyAll = hasDistinctReplyAllRecipients(
    hotkeyMessage,
    currentUserEmail
  );
  useMessageViewHotkeys({
    activeMailbox,
    canComposeFromMailbox: canComposeFromMailbox && !isBodyRefreshPending,
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
            <div className={cn("shrink-0", { "lg:hidden": !showDesktopBack })}>
              <IconButtonTooltip label="Back to list">
                <Button
                  aria-label="Back to list"
                  onClick={onBackToList}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden icon={ArrowLeft01Icon} />
                </Button>
              </IconButtonTooltip>
            </div>
          ) : null}
          <Text
            as="h1"
            className="min-w-0 flex-1"
            size="sm"
            title={subject}
            truncate
            weight="medium"
          >
            {subject}
          </Text>
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
                message={{
                  ...message,
                  threadIsImportant:
                    message.threadIsImportant ??
                    threadMessages.some((item) => item.isImportant === true),
                }}
                threadLabelIds={threadLabelIds}
              />
            </div>
          )}
          <div className={cn("shrink-0", { "lg:hidden": !detailOnly })}>
            <AssistantSidebarTrigger />
          </div>
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

      {mailboxProvider !== "api" &&
      composeDemoMode !== true &&
      composeManagedDemoMode !== true ? (
        <ThreadActionResults
          mailboxId={mailboxId}
          onOpenDraft={
            canComposeFromMailbox
              ? (draftMessage) => {
                  openInlineCompose(
                    buildComposeDraftFromSavedDraftMessage(draftMessage)
                  );
                }
              : undefined
          }
          threadId={message.threadId}
          threadMessages={threadMessages}
        />
      ) : null}

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
            onSetImportance={setMessageImportance}
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
          onSetImportance={setMessageImportance}
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
                      <ComposerEditorFrame className="min-h-64">
                        <output
                          aria-label="Loading inline composer"
                          aria-live="polite"
                          className="grid flex-1 place-items-center"
                        >
                          <Icon
                            aria-hidden
                            size={20}
                            tone="muted"
                            animation="spin"
                            icon={Loading03Icon}
                          />
                        </output>
                      </ComposerEditorFrame>
                    }
                  >
                    <InlineComposeSurface
                      actionDraft={actionDraft}
                      demoMode={composeDemoMode}
                      initialDraft={inlineDraft}
                      key={inlineDraft.localId}
                      mailboxId={mailboxId}
                      managedDemoMode={composeManagedDemoMode}
                      onClose={() => {
                        setInlineDraft(null);
                        setActionDraft(null);
                      }}
                      onManageSnippets={onManageSnippets}
                      persistDrafts={composePersistDrafts}
                      senderEmail={currentUserEmail}
                      senderMailbox={composeSenderMailbox}
                      signature={composeSignature}
                      variant="inline"
                    />
                  </Suspense>
                </m.div>
              ) : (
                <m.div
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  key="inline-reply-bar"
                  transition={inlineComposeFadeTransition}
                >
                  <ComposerActionBar>
                    <Button
                      disabled={
                        !hotkeyLinkedDraftMessage && isBodyRefreshPending
                      }
                      className="min-w-44 flex-1"
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
                      size="auto"
                      variant="ghost"
                    >
                      <Icon
                        aria-hidden
                        icon={
                          hotkeyLinkedDraftMessage
                            ? Edit01Icon
                            : MailReply02Icon
                        }
                      />
                      <Text
                        as="span"
                        className="min-w-0"
                        size="sm"
                        tone="muted"
                        truncate
                      >
                        {hotkeyLinkedDraftMessage
                          ? "Continue draft"
                          : `Reply to ${replyTargetLabel}`}
                      </Text>
                    </Button>
                    {showReplyAll ? (
                      <IconButtonTooltip label="Reply all">
                        <Button
                          aria-label="Reply all"
                          disabled={isBodyRefreshPending}
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
                          <Icon aria-hidden icon={MailReplyAll02Icon} />
                          <span className="hidden @sm:inline">Reply all</span>
                        </Button>
                      </IconButtonTooltip>
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
                        <Icon
                          aria-hidden
                          animation={
                            suggestReply.isPending ? "spin" : undefined
                          }
                          icon={
                            suggestReply.isPending
                              ? Loading03Icon
                              : SparklesIcon
                          }
                        />
                        <span aria-live="polite">
                          {suggestReply.isPending
                            ? "Suggesting reply…"
                            : "Suggest reply"}
                        </span>
                      </Button>
                    ) : null}
                    <IconButtonTooltip label="Forward">
                      <Button
                        aria-label="Forward"
                        disabled={isBodyRefreshPending}
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
                        <Icon aria-hidden icon={ArrowRightDoubleIcon} />
                        <span className="hidden @sm:inline">Forward</span>
                      </Button>
                    </IconButtonTooltip>
                  </ComposerActionBar>
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
