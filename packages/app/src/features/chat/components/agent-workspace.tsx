import type {
  WorkspacePanel,
  navigateInputSchema,
  navigateCalendarInputSchema,
  openInlineComposeInputSchema,
} from "@quieter/ai/chat-tools";
import { createForegroundControl } from "@quieter/app/features/chat/domain/foreground-control";
import { AgentWorkspaceContext } from "@quieter/app/features/chat/domain/workspace-context";
import type { ComposeFormValues } from "@quieter/app/features/compose/domain/compose-form";
import {
  createEmptyComposeDraft,
  textToComposeBodyHtml,
} from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR } from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import { useMailboxRouteSearch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { CalendarWorkspace } from "@quieter/calendar";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { z } from "zod";

import { isMailboxSupportedByProvider } from "../../mailbox/components/use-mailbox-commands";

export type CalendarBridge = {
  read: () => CalendarWorkspace;
  navigate: (
    input: z.infer<typeof navigateCalendarInputSchema>,
    signal?: AbortSignal
  ) => Promise<void>;
};

export type InlineComposeBridge = {
  mailboxId: string;
  threadId: string;
  open: (
    input: z.infer<typeof openInlineComposeInputSchema>
  ) => Pick<ComposeDraftState, "localId" | "draftId" | "draftAnchor">;
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
    followUpReminder?: ComposeDraftState["followUpReminder"];
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

type PanelKey = Exclude<WorkspacePanel, "snooze"> | `snooze:${string}`;

type OpenWorkspacePanel = (generation: number) => void | Promise<void>;

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
  const panels = new Map<PanelKey, OpenWorkspacePanel>();
  const panelListeners = new Set<() => void>();
  let compose: ComposeBridge | null = null;
  let calendar: CalendarBridge | null = null;
  let inlineCompose: InlineComposeBridge | null = null;
  let onComposeReady: (() => void) | undefined;
  let onCalendarReady: (() => void) | undefined;
  let onInlineComposeReady: (() => void) | undefined;
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
      inlineCompose = null;
      onComposeReady?.();
      onCalendarReady?.();
      onInlineComposeReady?.();
    },
    getCalendar: () => (disposed ? null : calendar),
    getCompose: () => (disposed ? null : compose),
    mailboxId,
    async openPanel(panel: PanelKey, generation: number) {
      if (!control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      let open = panels.get(panel);
      if (
        !open &&
        (panel.startsWith("snooze:") || panel === "new-calendar-event")
      ) {
        const ready = Promise.withResolvers<OpenWorkspacePanel>();
        const check = () => {
          const mounted = panels.get(panel);
          if (mounted !== undefined) {
            ready.resolve(mounted);
          }
        };
        const signal = control.signal();
        const cancel = () => {
          ready.reject(new Error("The request was stopped."));
        };
        const timeout = window.setTimeout(() => {
          ready.reject(
            new Error("This panel did not finish loading. Try again.")
          );
        }, 12_000);
        panelListeners.add(check);
        signal.addEventListener("abort", cancel, { once: true });
        try {
          open = await ready.promise;
        } finally {
          panelListeners.delete(check);
          signal.removeEventListener("abort", cancel);
          window.clearTimeout(timeout);
        }
        if (!control.isCurrent(generation) || panels.get(panel) !== open) {
          throw new Error("The view changed before the panel could open.");
        }
      }
      if (!open) {
        throw new Error("This panel is unavailable in the current view.");
      }
      if (document.querySelector(APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR)) {
        throw new Error(
          "Close the open menu or dialog before opening another panel."
        );
      }
      await open(generation);
    },
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
    registerInlineCompose(registered: InlineComposeBridge) {
      if (registered.mailboxId !== mailboxId) {
        throw new Error("The conversation belongs to another mailbox.");
      }
      inlineCompose = registered;
      onInlineComposeReady?.();
      return () => {
        if (inlineCompose === registered) {
          inlineCompose = null;
        }
      };
    },
    registerPanel(panel: PanelKey, open: OpenWorkspacePanel) {
      panels.set(panel, open);
      for (const listener of panelListeners) {
        listener();
      }
      return () => {
        if (panels.get(panel) === open) {
          panels.delete(panel);
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
    async waitForCompose(
      draftId: string,
      generation: number,
      expected?: Pick<ComposeDraftState, "draftId" | "draftAnchor">
    ) {
      const pending =
        Promise.withResolvers<ReturnType<ComposeBridge["read"]>>();
      const check = () => {
        if (!control.isCurrent(generation)) {
          pending.reject(new Error("The request was stopped."));
          return;
        }
        const mounted = compose?.read();
        const expectedAnchor = expected?.draftAnchor;
        const mountedAnchor = mounted?.draftAnchor;
        const matchesRecoveredDraft =
          expectedAnchor !== undefined &&
          expectedAnchor !== null &&
          mountedAnchor?.sourceMessageId === expectedAnchor.sourceMessageId &&
          mountedAnchor.sourceThreadId === expectedAnchor.sourceThreadId &&
          mountedAnchor.seededBy === expectedAnchor.seededBy &&
          (expected?.draftId === undefined ||
            mounted?.providerDraftId === expected.draftId);
        if (mounted && (mounted.draftId === draftId || matchesRecoveredDraft)) {
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
    async waitForInlineCompose(threadId: string, generation: number) {
      const pending = Promise.withResolvers<InlineComposeBridge>();
      const check = () => {
        if (!control.isCurrent(generation)) {
          pending.reject(new Error("The request was stopped."));
        } else if (inlineCompose?.threadId === threadId) {
          pending.resolve(inlineCompose);
        }
      };
      onInlineComposeReady = check;
      const subscription = control.state.subscribe(check);
      const timeout = window.setTimeout(() => {
        pending.reject(
          new Error("The conversation could not be opened. Try again.")
        );
      }, 20_000);
      check();
      try {
        return await pending.promise;
      } finally {
        if (onInlineComposeReady === check) {
          onInlineComposeReady = undefined;
        }
        subscription.unsubscribe();
        window.clearTimeout(timeout);
      }
    },
  };
};

export type WorkspaceBridge = Omit<
  ReturnType<typeof createWorkspaceBridge>,
  "activate" | "dispose" | "waitForInlineCompose"
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
      followUpReminder?: ComposeDraftState["followUpReminder"];
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
    input: z.infer<typeof navigateInputSchema>,
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
  openInlineCompose: (
    input: z.infer<typeof openInlineComposeInputSchema>,
    generation: number
  ) => Promise<{ draftId: string; draftRevision: number }>;
};

export const AgentWorkspaceProvider = ({
  children,
  mailboxId,
  mailboxProvider = null,
  onComposeDraftRequested,
}: {
  children: ReactNode;
  mailboxId: string;
  mailboxProvider?: Parameters<typeof isMailboxSupportedByProvider>[0];
  onComposeDraftRequested: (
    draft: ComposeDraftState,
    mailboxId?: string
  ) => void;
}) => {
  const route = useMailboxRouteSearch();
  const current = useRef({ mailboxProvider, onComposeDraftRequested, route });
  const activeMailboxId = useRef(mailboxId);
  const activeWorkspace = useRef(route.workspace);
  const assistantNavigation = useRef<{
    generation: number;
    workspace: "mail" | "calendar";
  } | null>(null);
  useLayoutEffect(() => {
    activeMailboxId.current = mailboxId;
    current.current = { mailboxProvider, onComposeDraftRequested, route };
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
        const selected = current.current.route;
        if (selected.workspace === "calendar") {
          assistantNavigation.current = { generation, workspace: "mail" };
        }
        const opensMailContent =
          input.messageId !== undefined ||
          input.threadId !== undefined ||
          input.query !== undefined;
        const revealsMailContent =
          opensMailContent &&
          (selected.isComposeMailbox ||
            selected.isScheduledMailbox ||
            selected.isSnippetMailbox ||
            selected.view === "labels" ||
            selected.view === "rules");
        const panelView =
          view === "all-inboxes" || view === "labels" || view === "rules";
        const mailbox: MailboxSearchPatch["mailbox"] =
          panelView || (view === undefined && revealsMailContent)
            ? "inbox"
            : view;
        let destinationView: MailboxSearchPatch["view"];
        if (panelView) {
          destinationView = view;
        } else if (view !== undefined || revealsMailContent) {
          destinationView = "inbox";
        }
        const provider = current.current.mailboxProvider;
        if (
          (view === "rules" && provider !== "managed") ||
          (mailbox !== undefined &&
            mailbox !== "snippets" &&
            !isMailboxSupportedByProvider(provider, mailbox))
        ) {
          throw new Error("This view is unavailable for the current mailbox.");
        }
        await current.current.route.setMailboxSearch(
          {
            mailbox,
            messageId:
              input.messageId ??
              (view === undefined && !opensMailContent ? undefined : null),
            query:
              input.query ??
              (view === undefined && !opensMailContent ? undefined : null),
            threadId:
              input.threadId ??
              (view === undefined && !opensMailContent ? undefined : null),
            view: destinationView,
            workspace: null,
          },
          { signal: bridge.control.signal() }
        );
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
          await mounted.navigate(input, bridge.control.signal());
          return;
        }
        if (current.current.route.workspace !== "calendar") {
          assistantNavigation.current = { generation, workspace: "calendar" };
        }
        await current.current.route.setMailboxSearch(
          {
            calendarConnectionId: input.connectionId,
            calendarDate: input.date,
            calendarEventId: input.eventId,
            calendarId: input.calendarId,
            calendarTimeZone: input.timeZone,
            calendarView: input.view,
            workspace: "calendar",
          },
          { signal: bridge.control.signal() }
        );
        await bridge.waitForCalendar(generation);
        const calendar = bridge.getCalendar();
        if (calendar === null || !bridge.control.isCurrent(generation)) {
          throw new Error("The request was stopped.");
        }
        await calendar.navigate(input, bridge.control.signal());
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
      async openInlineCompose(input, generation) {
        if (
          activeMailboxId.current !== mailboxId ||
          !bridge.control.isCurrent(generation)
        ) {
          throw new Error("The request was stopped.");
        }
        if (bridge.getCompose() || current.current.route.isComposeMailbox) {
          throw new Error(
            "A draft is already open. Read and edit that draft, or let the user close it first."
          );
        }
        await workspace.navigate(
          {
            messageId: input.messageId,
            threadId: input.threadId,
            view: "inbox",
          },
          generation
        );
        const inline = await bridge.waitForInlineCompose(
          input.threadId,
          generation
        );
        if (
          activeMailboxId.current !== mailboxId ||
          !bridge.control.isCurrent(generation)
        ) {
          throw new Error("The request was stopped.");
        }
        if (bridge.getCompose()) {
          throw new Error("A draft is already open. Read it before editing.");
        }
        const draft = inline.open(input);
        const mounted = await bridge.waitForCompose(
          draft.localId,
          generation,
          draft
        );
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
        const { view: selectedView } = selected;
        let view: string = selected.activeMailbox;
        if (selected.isComposeMailbox) {
          view = "compose";
        } else if (selected.isScheduledMailbox) {
          view = "scheduled";
        } else if (selected.isSnippetMailbox) {
          view = "snippets";
        } else if (
          selectedView === "all-inboxes" ||
          selectedView === "labels" ||
          selectedView === "rules"
        ) {
          view = selectedView;
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
                  followUpReminder: draft.followUpReminder,
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
      const { target } = event;
      if (
        !event.isTrusted ||
        !(target instanceof Element) ||
        (event instanceof KeyboardEvent &&
          ([
            "Tab",
            "Shift",
            "Control",
            "Alt",
            "Meta",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key) ||
            ((event.ctrlKey || event.metaKey) &&
              ["a", "c", "f"].includes(event.key.toLowerCase())))) ||
        (event instanceof PointerEvent && event.button !== 0) ||
        target.closest("[data-assistant-panel], [data-assistant-launcher]")
      ) {
        return;
      }
      if (
        (event.type === "pointerdown" ||
          (event instanceof KeyboardEvent &&
            [" ", "Backspace", "Delete"].includes(event.key))) &&
        !target.closest(
          "a[href], button:enabled, input:enabled, label, select:enabled, summary, textarea:enabled, [contenteditable=''], [contenteditable='true'], [role='button'], [role='link'], [role='menuitem'], [role='option'], [role='tab']"
        )
      ) {
        return;
      }
      bridge.control.cancel();
    };
    const onBack = () => {
      bridge.control.cancel();
    };
    document.addEventListener("pointerdown", takeOver, true);
    document.addEventListener("keydown", takeOver, true);
    document.addEventListener("input", takeOver, true);
    window.addEventListener("popstate", onBack);
    return () => {
      bridge.control.cancel();
      document.removeEventListener("pointerdown", takeOver, true);
      document.removeEventListener("keydown", takeOver, true);
      document.removeEventListener("input", takeOver, true);
      window.removeEventListener("popstate", onBack);
    };
  }, [bridge]);

  return (
    <AgentWorkspaceContext value={workspace}>{children}</AgentWorkspaceContext>
  );
};
