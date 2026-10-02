import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ComposeFormValues } from "#/features/compose/domain/compose-form";
import {
  createEmptyComposeDraft,
  textToComposeBodyHtml,
} from "#/features/compose/domain/draft";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { useMailboxRouteSearch } from "#/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";

import { createForegroundControl } from "../domain/foreground-control";
import { AgentWorkspaceContext } from "../domain/workspace-context";

type ComposeBridge = {
  applyReceipt: (receipt: {
    draftId: string;
    draftRevision: number;
    status: "draft_saved" | "sent";
    providerDraftId?: string;
    messageId?: string;
  }) => void;
  read: () => {
    attachments: ComposeDraftState["attachments"];
    inlineImages: ComposeDraftState["inlineImages"];
    draftId: string;
    draftRevision: number;
    providerDraftId?: string;
    replyContext?: ComposeDraftState["replyContext"];
    values: ComposeFormValues;
  };
  edit: (values: Partial<ComposeFormValues>, revision: number) => void;
};

const createWorkspaceBridge = () => {
  const control = createForegroundControl();
  let compose: ComposeBridge | null = null;
  let onComposeReady: (() => void) | undefined;
  return {
    control,
    getCompose: () => compose,
    registerCompose(bridge: ComposeBridge) {
      compose = bridge;
      onComposeReady?.();
      return () => {
        if (compose === bridge) {
          compose = null;
        }
      };
    },
    async waitForCompose(draftId: string, generation: number) {
      const pending =
        Promise.withResolvers<ReturnType<ComposeBridge["read"]>>();
      const check = () => {
        if (!control.isCurrent(generation)) {
          pending.reject(new Error("The request was stopped."));
          return;
        }
        const mounted = compose?.read();
        if (mounted?.draftId === draftId) {
          pending.resolve(mounted);
        }
      };
      onComposeReady = check;
      const subscription = control.state.subscribe(check);
      const timeout = window.setTimeout(() => {
        pending.reject(new Error("The draft could not be opened. Try again."));
      }, 20_000);
      check();
      try {
        return await pending.promise;
      } finally {
        if (onComposeReady === check) {
          onComposeReady = undefined;
        }
        subscription.unsubscribe();
        window.clearTimeout(timeout);
      }
    },
  };
};

export type WorkspaceBridge = ReturnType<typeof createWorkspaceBridge> & {
  mailboxId: string;
  read: () => {
    generation: number;
    mailboxId: string;
    selectedMessageId?: string;
    selectedThreadId?: string;
    query: string;
    view: string;
    draftId?: string;
    draftRevision?: number;
    draft?: {
      attachments: ComposeDraftState["attachments"];
      inlineImages: ComposeDraftState["inlineImages"];
      bodyHtml: string;
      draftId: string;
      draftRevision: number;
      providerDraftId?: string;
      replyContext?: ComposeDraftState["replyContext"];
      to: string;
      cc: string;
      bcc: string;
      subject: string;
      bodyText: string;
    };
  };
  navigate: (
    input: {
      messageId?: string;
      threadId?: string;
      query?: string;
      view?: string;
    },
    generation: number
  ) => Promise<void>;
  openCompose: (
    input: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      bodyText?: string;
    },
    generation: number
  ) => Promise<{ draftId: string; draftRevision: number }>;
};

export const AgentWorkspaceProvider = ({
  children,
  mailboxId,
  onComposeDraftRequested,
}: {
  children: ReactNode;
  mailboxId: string;
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
}) => {
  const route = useMailboxRouteSearch();
  const current = useRef({ onComposeDraftRequested, route });
  useLayoutEffect(() => {
    current.current = { onComposeDraftRequested, route };
  });
  // oxlint-disable-next-line react/hook-use-state -- The mailbox owns one controller instance for its lifetime.
  const [bridge] = useState(createWorkspaceBridge);
  // oxlint-disable-next-line react/hook-use-state -- Keep command registrations stable across route changes.
  const [workspace] = useState<WorkspaceBridge>(() => ({
    ...bridge,
    mailboxId,
    async navigate(input, generation) {
      if (!bridge.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      const { view } = input;
      if (
        view !== undefined &&
        ![
          "inbox",
          "unread",
          "archive",
          "spam",
          "sent",
          "trash",
          "drafts",
          "template",
          "labels",
        ].includes(view)
      ) {
        throw new Error("This view is not available.");
      }
      await current.current.route.setMailboxSearch({
        ...(view === undefined
          ? {}
          : { view: view === "labels" ? "labels" : "inbox" }),
        ...(view === "inbox" ||
        view === "unread" ||
        view === "archive" ||
        view === "spam" ||
        view === "sent" ||
        view === "trash" ||
        view === "drafts" ||
        view === "template"
          ? { mailbox: view }
          : {}),
        messageId: input.messageId ?? (view === undefined ? undefined : null),
        query: input.query ?? (view === undefined ? undefined : null),
        threadId: input.threadId ?? (view === undefined ? undefined : null),
      });
    },
    async openCompose(input, generation) {
      if (!bridge.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      if (bridge.getCompose() || current.current.route.isComposeMailbox) {
        throw new Error(
          "A draft is already open. Edit that draft or let the user close it first."
        );
      }
      const draft = createEmptyComposeDraft();
      current.current.onComposeDraftRequested({
        ...draft,
        assistantUnsaved: true,
        bodyHtml: textToComposeBodyHtml(input.bodyText ?? ""),
        bodyText: input.bodyText ?? "",
        recipients: {
          bcc: input.bcc ?? "",
          cc: input.cc ?? "",
          to: input.to ?? "",
        },
        subject: input.subject ?? "",
      });
      const mounted = await bridge.waitForCompose(draft.localId, generation);
      return { draftId: mounted.draftId, draftRevision: mounted.draftRevision };
    },
    read() {
      const selected = current.current.route;
      const draft = bridge.getCompose()?.read();
      let view: string = selected.activeMailbox;
      if (selected.isComposeMailbox) {
        view = "compose";
      } else if (selected.isTemplateMailbox) {
        view = "template";
      } else if (selected.view === "labels") {
        view = "labels";
      }
      return {
        generation: bridge.control.state.get().generation,
        mailboxId,
        query: selected.query,
        selectedMessageId: selected.messageId,
        selectedThreadId: selected.threadId,
        view,
        ...(draft
          ? {
              draft: {
                attachments: draft.attachments,
                bcc: draft.values.bcc,
                bodyHtml: draft.values.bodyHtml,
                bodyText: draft.values.bodyText,
                cc: draft.values.cc,
                draftId: draft.draftId,
                draftRevision: draft.draftRevision,
                inlineImages: draft.inlineImages,
                providerDraftId: draft.providerDraftId,
                replyContext: draft.replyContext,
                subject: draft.values.subject,
                to: draft.values.to,
              },
              draftId: draft.draftId,
              draftRevision: draft.draftRevision,
            }
          : {}),
      };
    },
  }));

  useEffect(() => {
    const takeOver = (event: Event) => {
      if (
        !event.isTrusted ||
        (event instanceof KeyboardEvent &&
          ["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key))
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(
          "[data-assistant-panel], [data-assistant-launcher]"
        )
      ) {
        return;
      }
      bridge.control.cancel();
    };
    const onVisibility = () => {
      if (document.hidden) {
        bridge.control.cancel();
      }
    };
    const onBack = () => {
      bridge.control.cancel();
    };
    document.addEventListener("pointerdown", takeOver, true);
    document.addEventListener("keydown", takeOver, true);
    document.addEventListener("input", takeOver, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("popstate", onBack);
    return () => {
      bridge.control.cancel();
      document.removeEventListener("pointerdown", takeOver, true);
      document.removeEventListener("keydown", takeOver, true);
      document.removeEventListener("input", takeOver, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("popstate", onBack);
    };
  }, [bridge]);

  return (
    <AgentWorkspaceContext value={workspace}>{children}</AgentWorkspaceContext>
  );
};
