import type { navigateCalendarInputSchema } from "@quieter/ai/chat-tools";
import { createForegroundControl } from "@quieter/app/features/chat/domain/foreground-control";
import { AgentWorkspaceContext } from "@quieter/app/features/chat/domain/workspace-context";
import type { ComposeFormValues } from "@quieter/app/features/compose/domain/compose-form";
import {
  createEmptyComposeDraft,
  textToComposeBodyHtml,
} from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { useMailboxRouteSearch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { CalendarWorkspace } from "@quieter/calendar";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { z } from "zod";

export type CalendarBridge = {
  read: () => CalendarWorkspace;
  navigate: (
    input: z.infer<typeof navigateCalendarInputSchema>
  ) => Promise<void>;
};

type ComposeBridge = {
  applyReceipt: (receipt: {
    attachments?: ComposeDraftState["attachments"];
    baseRevision?: string;
    draftId: string;
    draftRevision: number;
    status: "draft_saved" | "sent";
    providerDraftId?: string;
    messageId?: string;
    inlineImages?: ComposeDraftState["inlineImages"];
  }) => void;
  read: () => {
    attachments: ComposeDraftState["attachments"];
    baseRevision?: string;
    draftAnchor?: ComposeDraftState["draftAnchor"];
    inlineImages: ComposeDraftState["inlineImages"];
    draftId: string;
    draftRevision: number;
    providerDraftId?: string;
    messageId?: string;
    sendOperationId?: string;
    sendUncertain?: boolean;
    replyContext?: ComposeDraftState["replyContext"];
    values: ComposeFormValues;
  };
  edit: (values: Partial<ComposeFormValues>, revision: number) => void;
};

const createWorkspaceBridge = (mailboxId: string) => {
  const foregroundControl = createForegroundControl();
  let disposed = false;
  const control = {
    ...foregroundControl,
    begin() {
      if (disposed) {
        throw new Error("The request was stopped.");
      }
      return foregroundControl.begin();
    },
    isCurrent(generation: number) {
      return !disposed && foregroundControl.isCurrent(generation);
    },
  };
  let compose: ComposeBridge | null = null;
  let calendar: CalendarBridge | null = null;
  let onComposeReady: (() => void) | undefined;
  let onCalendarReady: (() => void) | undefined;
  return {
    activate() {
      disposed = false;
    },
    control,
    dispose() {
      disposed = true;
      foregroundControl.cancel();
      compose = null;
      calendar = null;
      onComposeReady?.();
      onCalendarReady?.();
    },
    getCalendar: () => (disposed ? null : calendar),
    getCompose: () => (disposed ? null : compose),
    mailboxId,
    registerCalendar(registered: CalendarBridge) {
      calendar = registered;
      onCalendarReady?.();
      return () => {
        if (calendar === registered) {
          calendar = null;
        }
      };
    },
    registerCompose(bridge: ComposeBridge) {
      compose = bridge;
      onComposeReady?.();
      return () => {
        if (compose === bridge) {
          compose = null;
        }
      };
    },
    async waitForCalendar(generation: number) {
      const pending = Promise.withResolvers<CalendarWorkspace>();
      const check = () => {
        if (!control.isCurrent(generation)) {
          pending.reject(new Error("The request was stopped."));
        } else if (calendar !== null) {
          pending.resolve(calendar.read());
        }
      };
      onCalendarReady = check;
      const subscription = control.state.subscribe(check);
      const timeout = window.setTimeout(() => {
        pending.reject(
          new Error("The calendar could not be opened. Try again.")
        );
      }, 20_000);
      check();
      try {
        return await pending.promise;
      } finally {
        if (onCalendarReady === check) {
          onCalendarReady = undefined;
        }
        subscription.unsubscribe();
        window.clearTimeout(timeout);
      }
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

export type WorkspaceBridge = Omit<
  ReturnType<typeof createWorkspaceBridge>,
  "activate" | "dispose"
> & {
  read: () => {
    calendar?: CalendarWorkspace;
    generation: number;
    mailboxId: string;
    selectedMessageId?: string;
    selectedThreadId?: string;
    query: string;
    view: string;
    workspace: "mail" | "calendar";
    draftId?: string;
    draftRevision?: number;
    draft?: {
      attachments: ComposeDraftState["attachments"];
      baseRevision?: string;
      draftAnchor?: ComposeDraftState["draftAnchor"];
      inlineImages: ComposeDraftState["inlineImages"];
      bodyHtml: string;
      draftId: string;
      draftRevision: number;
      providerDraftId?: string;
      messageId?: string;
      sendOperationId?: string;
      sendUncertain?: boolean;
      senderName: string;
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
  navigateCalendar: (
    input: z.infer<typeof navigateCalendarInputSchema>,
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
  onComposeDraftRequested: (
    draft: ComposeDraftState,
    mailboxId?: string
  ) => void;
}) => {
  const route = useMailboxRouteSearch();
  const current = useRef({ onComposeDraftRequested, route });
  const activeMailboxId = useRef(mailboxId);
  const activeWorkspace = useRef(route.workspace);
  const assistantNavigation = useRef<{
    generation: number;
    workspace: "mail" | "calendar";
  } | null>(null);
  useLayoutEffect(() => {
    activeMailboxId.current = mailboxId;
    current.current = { onComposeDraftRequested, route };
  });
  const bridge = useMemo(() => createWorkspaceBridge(mailboxId), [mailboxId]);
  useLayoutEffect(() => {
    if (activeWorkspace.current !== route.workspace) {
      const expected = assistantNavigation.current;
      if (
        expected?.workspace !== (route.workspace ?? "mail") ||
        !bridge.control.isCurrent(expected.generation)
      ) {
        bridge.control.cancel();
      }
      assistantNavigation.current = null;
      activeWorkspace.current = route.workspace;
    }
  }, [bridge, route.workspace]);
  useLayoutEffect(() => {
    bridge.activate();
    return () => {
      bridge.dispose();
    };
  }, [bridge]);
  const workspace = useMemo<WorkspaceBridge>(
    () => ({
      ...bridge,
      async navigate(input, generation) {
        if (
          activeMailboxId.current !== mailboxId ||
          !bridge.control.isCurrent(generation)
        ) {
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
            "snippets",
            "labels",
          ].includes(view)
        ) {
          throw new Error("This view is not available.");
        }
        if (current.current.route.workspace === "calendar") {
          assistantNavigation.current = { generation, workspace: "mail" };
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
          view === "snippets"
            ? { mailbox: view }
            : {}),
          messageId: input.messageId ?? (view === undefined ? undefined : null),
          query: input.query ?? (view === undefined ? undefined : null),
          threadId: input.threadId ?? (view === undefined ? undefined : null),
          workspace: null,
        });
      },
      async navigateCalendar(input, generation) {
        if (
          activeMailboxId.current !== mailboxId ||
          !bridge.control.isCurrent(generation)
        ) {
          throw new Error("The request was stopped.");
        }
        const mounted = bridge.getCalendar();
        if (
          current.current.route.workspace === "calendar" &&
          mounted !== null
        ) {
          await mounted.navigate(input);
          return;
        }
        if (current.current.route.workspace !== "calendar") {
          assistantNavigation.current = { generation, workspace: "calendar" };
        }
        await current.current.route.setMailboxSearch({
          calendarConnectionId: input.connectionId,
          calendarDate: input.date,
          calendarEventId: input.eventId,
          calendarId: input.calendarId,
          calendarTimeZone: input.timeZone,
          calendarView: input.view,
          workspace: "calendar",
        });
        await bridge.waitForCalendar(generation);
        const calendar = bridge.getCalendar();
        if (calendar === null || !bridge.control.isCurrent(generation)) {
          throw new Error("The request was stopped.");
        }
        await calendar.navigate(input);
      },
      async openCompose(input, generation) {
        if (
          activeMailboxId.current !== mailboxId ||
          !bridge.control.isCurrent(generation)
        ) {
          throw new Error("The request was stopped.");
        }
        if (current.current.route.workspace === "calendar") {
          throw new Error("Open Mail before composing an email.");
        }
        if (bridge.getCompose() || current.current.route.isComposeMailbox) {
          throw new Error(
            "A draft is already open. Edit that draft or let the user close it first."
          );
        }
        const draft = createEmptyComposeDraft();
        current.current.onComposeDraftRequested(
          {
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
          },
          mailboxId
        );
        const mounted = await bridge.waitForCompose(draft.localId, generation);
        return {
          draftId: mounted.draftId,
          draftRevision: mounted.draftRevision,
        };
      },
      read() {
        if (activeMailboxId.current !== mailboxId) {
          throw new Error("The request was stopped.");
        }
        const selected = current.current.route;
        if (selected.workspace === "calendar") {
          const calendar = bridge.getCalendar()?.read();
          if (calendar === undefined) {
            throw new Error(
              "The calendar is still opening. Try again shortly."
            );
          }
          return {
            calendar,
            generation: bridge.control.state.get().generation,
            mailboxId,
            query: "",
            view: "calendar",
            workspace: "calendar",
          };
        }
        const draft = bridge.getCompose()?.read();
        let view: string = selected.activeMailbox;
        if (selected.isComposeMailbox) {
          view = "compose";
        } else if (selected.isSnippetMailbox) {
          view = "snippets";
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
          workspace: "mail",
          ...(draft
            ? {
                draft: {
                  attachments: draft.attachments,
                  baseRevision: draft.baseRevision,
                  bcc: draft.values.bcc,
                  bodyHtml: draft.values.bodyHtml,
                  bodyText: draft.values.bodyText,
                  cc: draft.values.cc,
                  draftAnchor: draft.draftAnchor,
                  draftId: draft.draftId,
                  draftRevision: draft.draftRevision,
                  inlineImages: draft.inlineImages,
                  messageId: draft.messageId,
                  providerDraftId: draft.providerDraftId,
                  replyContext: draft.replyContext,
                  sendOperationId: draft.sendOperationId,
                  sendUncertain: draft.sendUncertain,
                  senderName: draft.values.senderName,
                  subject: draft.values.subject,
                  to: draft.values.to,
                },
                draftId: draft.draftId,
                draftRevision: draft.draftRevision,
              }
            : {}),
        };
      },
    }),
    [bridge, mailboxId]
  );

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
