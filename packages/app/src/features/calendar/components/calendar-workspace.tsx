"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  LayoutRightIcon,
  Loading03Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import { MobileHeader } from "@quieter/app/components/mobile-header";
import { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import { useMailboxRouteSearch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { getAppPresenceMotion } from "@quieter/app/features/motion/app-motion";
import {
  calendarEventQueryOptions,
  calendarEventsQueryOptions,
  getCalendarCacheMonthRanges,
} from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { openGoogleAccountLink } from "@quieter/app/lib/google-account-link";
import { usePreviewPersona } from "@quieter/app/lib/preview-personas";
import type {
  CalendarEvent,
  CalendarEventTime,
  CalendarMutationResult,
  CalendarRef,
  CalendarSummary,
  CalendarView,
  CalendarWorkspace as CalendarWorkspaceState,
} from "@quieter/calendar";
import {
  calendarWallTimeToInstant,
  getCalendarRange,
  getZonedDateTimeFields,
  moveCalendarEventTime,
} from "@quieter/calendar/time";
import { ActionFooter } from "@quieter/ui/action-footer";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { Pill } from "@quieter/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Schedule } from "@quieter/ui/schedule";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { createCalendarEventEditorStore } from "../domain/calendar-event-editor";
import {
  addCalendarDays,
  createCalendarEventChanges,
  getCalendarEventKey,
  getCalendarRefKey,
} from "../domain/calendar-event-form";
import type { CalendarEditor } from "../domain/calendar-event-form";
import {
  getVisibleCalendarEventRef,
  toggleCalendarGroupVisibility,
} from "../domain/calendar-groups";
import { getCalendarSchedule } from "../domain/calendar-schedule";
import { CalendarEventDetails } from "./calendar-event-details";
import { CalendarEventEditor } from "./calendar-event-editor";
import { CalendarSidebar } from "./calendar-sidebar";
import type { CalendarConnectionTarget } from "./calendar-sidebar";
import { CalendarTimeZonePicker } from "./calendar-time-zone-picker";
import { useCalendarData } from "./use-calendar-data";

type CalendarConfirmation =
  | { kind: "delete"; event: CalendarEvent; scope: "occurrence" | "series" }
  | { kind: "move"; event: CalendarEvent; time: CalendarEventTime };

type CalendarUiState = {
  confirmation: CalendarConfirmation | null;
  editor: CalendarEditor | null;
  hiddenCalendarKeys: string[];
  loadingSeries: boolean;
  pendingConnection: CalendarConnectionTarget | null;
  recurringAction: CalendarEvent | null;
  search: string;
};

type CalendarWorkspaceProps = {
  userId: string;
  isMobileSidebarOpen: boolean;
  onMobileSidebarOpenChange: (open: boolean) => void;
};

const calendarPreferencesSchema = z.object({
  hiddenCalendarKeys: z.array(z.string()).max(100),
});
const viewOptions = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Agenda", value: "agenda" },
] satisfies { label: string; value: CalendarView }[];

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Browser subscriptions are the synchronous useSyncExternalStore contract.
const subscribeToOnline = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};
const getOnlineSnapshot = () => navigator.onLine;
const getServerOnlineSnapshot = () => true;
const CalendarWorkspaceContent = ({
  isMobileSidebarOpen,
  onMobileSidebarOpenChange,
  userId,
  preview,
}: CalendarWorkspaceProps & { preview: string | null }) => {
  const { weekStartsOn } = useDateTimePreferences();
  const assistant = use(AssistantSidebarContext);
  const route = useMailboxRouteSearch();
  const { setMailboxSearch } = route;
  const queryClient = useQueryClient();
  const agentWorkspace = useAgentWorkspace();
  const online = useSyncExternalStore(
    subscribeToOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  );
  const reducedMotion = useReducedMotion();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect((): (() => void) | undefined => {
    const element = workspaceRef.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWide((entry?.contentRect.width ?? 0) >= 720);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const timeZone =
    route.calendarTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [currentInstant, setCurrentInstant] = useState(() =>
    new Date().toISOString()
  );
  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentInstant(new Date().toISOString());
    }, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);
  const now = getZonedDateTimeFields({
    instant: currentInstant,
    timeZone,
  });
  const date = route.calendarDate ?? now.date;
  const view = route.calendarView ?? "week";
  const range = useMemo(
    () => getCalendarRange({ date, timeZone, view, weekStartsOn }),
    [date, timeZone, view, weekStartsOn]
  );
  const preferencesKey = `quieter:calendar-preferences:${userId}:${preview ?? "live"}`;
  const initialPreferences = useMemo<string[]>(() => {
    try {
      const parsed: unknown = JSON.parse(
        window.localStorage.getItem(preferencesKey) ?? "null"
      );
      const preferences = calendarPreferencesSchema.safeParse(parsed);
      return preferences.success ? preferences.data.hiddenCalendarKeys : [];
    } catch {
      return [];
    }
  }, [preferencesKey]);
  const store = useCreateStore<CalendarUiState>({
    confirmation: null,
    editor: null,
    hiddenCalendarKeys: initialPreferences,
    loadingSeries: false,
    pendingConnection: null,
    recurringAction: null,
    search: "",
  });
  const ui = useSelector(store, (current) => current);
  const [editorSession, setEditorSession] = useState<{
    key: string;
    store: ReturnType<typeof createCalendarEventEditorStore>;
  } | null>(null);
  const revealCalendar = useEffectEvent((ref: CalendarRef) => {
    const target = getCalendarRefKey(ref);
    store.setState((current) =>
      current.hiddenCalendarKeys.includes(target)
        ? {
            ...current,
            hiddenCalendarKeys: current.hiddenCalendarKeys.filter(
              (key) => key !== target
            ),
          }
        : current
    );
  });
  useLayoutEffect(() => {
    if (
      route.workspace === "calendar" &&
      route.calendarConnectionId &&
      route.calendarId &&
      route.calendarEventId
    ) {
      revealCalendar({
        calendarId: route.calendarId,
        connectionId: route.calendarConnectionId,
      });
    }
  }, [
    route.calendarConnectionId,
    route.calendarEventId,
    route.calendarId,
    route.workspace,
  ]);
  const data = useCalendarData({
    date,
    hiddenCalendarKeys: ui.hiddenCalendarKeys,
    preview,
    range: { end: range.end, start: range.start, timeZone },
    userId,
  });
  const requestedEventRef =
    route.calendarConnectionId && route.calendarId && route.calendarEventId
      ? {
          calendarId: route.calendarId,
          connectionId: route.calendarConnectionId,
          eventId: route.calendarEventId,
        }
      : undefined;
  const selectedRef = requestedEventRef
    ? getVisibleCalendarEventRef({
        groups: data.calendarGroups,
        hiddenCalendarKeys: ui.hiddenCalendarKeys,
        ref: requestedEventRef,
      })
    : undefined;
  const selectedOptions = calendarEventQueryOptions(
    userId,
    selectedRef ?? {
      calendarId: "none",
      connectionId: "none",
      eventId: "none",
    }
  );
  const selectedQuery = useQuery({
    ...selectedOptions,
    enabled:
      preview === null &&
      selectedRef !== undefined &&
      data.accounts.some(
        (account) =>
          account.id === selectedRef.connectionId &&
          account.status === "connected"
      ),
    initialData: () =>
      selectedRef
        ? data.confirmedEvents.find(
            (event) =>
              getCalendarEventKey(event) === getCalendarEventKey(selectedRef)
          )
        : undefined,
    persister: preview ? undefined : selectedOptions.persister,
    queryKey: preview
      ? ["calendar-preview", userId, preview, "event", selectedRef]
      : selectedOptions.queryKey,
  });
  const editingEvent = ui.editor?.kind === "edit" ? ui.editor.event : null;
  const editingOptions = calendarEventQueryOptions(
    userId,
    editingEvent ?? {
      calendarId: "none",
      connectionId: "none",
      eventId: "none",
    }
  );
  const editingQuery = useQuery({
    ...editingOptions,
    enabled:
      preview === null &&
      selectedRef !== undefined &&
      editingEvent !== null &&
      data.accounts.some(
        (account) =>
          account.id === editingEvent.connectionId &&
          account.status === "connected"
      ),
    initialData: editingEvent ?? undefined,
    persister: preview ? undefined : editingOptions.persister,
    queryKey: preview
      ? ["calendar-preview", userId, preview, "editing-event", editingEvent]
      : editingOptions.queryKey,
  });
  let selectedEvent: CalendarEvent | undefined;
  if (selectedRef) {
    selectedEvent = preview
      ? data.confirmedEvents.find(
          (event) =>
            getCalendarEventKey(event) === getCalendarEventKey(selectedRef)
        )
      : selectedQuery.data;
  }
  if (selectedEvent) {
    selectedEvent = data.displayEvent(selectedEvent);
  }
  const visibleRefs = data.visibleCalendars.map((calendar) => ({
    calendarId: calendar.calendarId,
    connectionId: calendar.connectionId,
  }));
  const bridgeState = useRef<CalendarWorkspaceState>({
    date,
    timeZone,
    view,
    visibleCalendars: visibleRefs,
  });
  const renderedWorkspace = {
    date,
    selectedEvent: selectedEvent
      ? {
          calendarId: selectedEvent.calendarId,
          connectionId: selectedEvent.connectionId,
          eventId: selectedEvent.eventId,
        }
      : undefined,
    timeZone,
    view,
    visibleCalendars: visibleRefs,
  } satisfies CalendarWorkspaceState;
  useLayoutEffect(() => {
    bridgeState.current = renderedWorkspace;
  });
  const setRoute = useEffectEvent(setMailboxSearch);
  useLayoutEffect(
    () =>
      agentWorkspace?.registerCalendar({
        navigate: async (input) => {
          if (input.connectionId && input.calendarId) {
            revealCalendar({
              calendarId: input.calendarId,
              connectionId: input.connectionId,
            });
          }
          await setRoute({
            calendarConnectionId: input.connectionId,
            calendarDate: input.date,
            calendarEventId: input.eventId,
            calendarId: input.calendarId,
            calendarTimeZone: input.timeZone,
            calendarView: input.view,
            workspace: "calendar",
          });
        },
        read: () => bridgeState.current,
      }),
    [agentWorkspace, store]
  );
  const prefetchFingerprint = JSON.stringify({
    date,
    preview,
    timeZone,
    userId,
    view,
    visibleRefs,
  });
  const prefetchAdjacent = useEffectEvent(async (signal: AbortSignal) => {
    const first = new Date(`${range.dates[0] ?? date}T12:00:00Z`);
    const last = new Date(`${range.dates.at(-1) ?? date}T12:00:00Z`);
    first.setUTCDate(1);
    first.setUTCMonth(first.getUTCMonth() - 1);
    last.setUTCDate(1);
    last.setUTCMonth(last.getUTCMonth() + 1);
    const neighbors = [first, last].flatMap((neighbor) =>
      getCalendarCacheMonthRanges({
        ...getCalendarRange({
          date: neighbor.toISOString().slice(0, 10),
          timeZone,
          view: "day",
        }),
        timeZone,
      })
    );
    for (const ref of visibleRefs) {
      if (signal.aborted || preview !== null || !navigator.onLine) {
        return;
      }
      await Promise.allSettled(
        neighbors.map(async (neighbor) => {
          await queryClient.query(
            calendarEventsQueryOptions(userId, ref, {
              end: neighbor.end,
              start: neighbor.start,
              timeZone,
            })
          );
        })
      );
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    void prefetchAdjacent(controller.signal);
    return () => {
      controller.abort();
    };
  }, [prefetchFingerprint]);
  const closeEvent = () => {
    store.setState((current) =>
      current.editor === null ? current : { ...current, editor: null }
    );
    void setMailboxSearch({ calendarEventId: null });
  };
  const selectEvent = (event: CalendarEvent) => {
    store.setState((current) =>
      current.editor === null ? current : { ...current, editor: null }
    );
    void setMailboxSearch({
      calendarConnectionId: event.connectionId,
      calendarEventId: event.eventId,
      calendarId: event.calendarId,
    });
  };
  const writableCalendars = data.calendars.filter(
    (calendar) =>
      (calendar.access === "owner" || calendar.access === "write") &&
      data.accounts.some(
        (account) =>
          account.id === calendar.connectionId && account.status === "connected"
      )
  );
  const createEvent = ({
    allDay,
    date: eventDate,
    endMinute,
    minute,
  }: {
    allDay: boolean;
    date: string;
    endMinute?: number;
    minute: number;
  }) => {
    const calendar =
      writableCalendars.find(
        (candidate) =>
          candidate.calendarId === route.calendarId &&
          candidate.connectionId === route.calendarConnectionId
      ) ??
      writableCalendars.find((candidate) => candidate.primary) ??
      writableCalendars.at(0);
    if (!calendar) {
      toastError(
        { message: "Choose a calendar you can add events to.", status: 403 },
        { boundary: "calendar" }
      );
      return;
    }
    try {
      const start = allDay
        ? undefined
        : calendarWallTimeToInstant({
            date: eventDate,
            time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
            timeZone,
          });
      const time: CalendarEventTime = start
        ? {
            end:
              endMinute === undefined
                ? new Date(Date.parse(start) + 60 * 60 * 1000).toISOString()
                : calendarWallTimeToInstant({
                    date:
                      endMinute === 1440
                        ? addCalendarDays(eventDate, 1)
                        : eventDate,
                    time:
                      endMinute === 1440
                        ? "00:00"
                        : `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`,
                    timeZone,
                  }),
            kind: "timed",
            start,
            timeZone,
          }
        : {
            endDate: addCalendarDays(eventDate, 1),
            kind: "all-day",
            startDate: eventDate,
          };
      store.setState((current) => ({
        ...current,
        editor: {
          kind: "create",
          operationId: crypto.randomUUID(),
          ref: {
            calendarId: calendar.calendarId,
            connectionId: calendar.connectionId,
          },
          time,
        },
      }));
    } catch (error) {
      toastError(
        {
          message:
            error instanceof Error
              ? error.message
              : "Choose a valid event time.",
          status: 400,
        },
        { boundary: "calendar" }
      );
    }
  };
  const connect = async (target: CalendarConnectionTarget) => {
    if (store.get().pendingConnection) {
      return;
    }
    const account =
      target.kind === "account"
        ? data.accounts.find((candidate) => candidate.id === target.accountId)
        : undefined;
    if (target.kind === "account" && !account) {
      return;
    }
    store.setState((current) => ({ ...current, pendingConnection: target }));
    try {
      await openGoogleAccountLink({
        loginHint: account?.email ?? undefined,
        mailboxId: account?.mailboxId ?? undefined,
        queryClient,
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      });
    } catch (error) {
      toastError(error, { boundary: "calendar" });
    } finally {
      store.setState((current) => ({ ...current, pendingConnection: null }));
    }
  };
  const reloadEvent = async (event: CalendarEvent) => {
    if (preview) {
      return (
        data.events.find(
          (candidate) =>
            getCalendarEventKey(candidate) === getCalendarEventKey(event)
        ) ?? event
      );
    }
    return await queryClient.query({
      ...calendarEventQueryOptions(userId, {
        calendarId: event.calendarId,
        connectionId: event.connectionId,
        eventId: event.eventId,
      }),
      staleTime: 0,
    });
  };
  const requestDelete = (event: CalendarEvent) => {
    if (event.recurringEventId || event.recurrence.length > 0) {
      store.setState((current) => ({ ...current, recurringAction: event }));
    } else {
      store.setState((current) => ({
        ...current,
        confirmation: { event, kind: "delete", scope: "occurrence" },
      }));
    }
  };
  const chooseRecurrenceScope = async (scope: "occurrence" | "series") => {
    const action = ui.recurringAction;
    if (!action) {
      return;
    }
    store.setState((current) => ({ ...current, loadingSeries: true }));
    try {
      const event =
        scope === "series"
          ? await reloadEvent({
              ...action,
              eventId: action.recurringEventId ?? action.eventId,
            })
          : action;
      store.setState((current) => ({
        ...current,
        confirmation: { event, kind: "delete", scope },
        loadingSeries: false,
        recurringAction: null,
      }));
    } catch (error) {
      store.setState((current) => ({ ...current, loadingSeries: false }));
      toastError(error, { boundary: "calendar" });
    }
  };
  const applyTime = async (event: CalendarEvent, time: CalendarEventTime) => {
    if (!event.permissions.edit) {
      toastError(
        { message: "You cannot edit this event.", status: 403 },
        { boundary: "calendar" }
      );
      return;
    }
    if (
      event.recurringEventId ||
      event.recurrence.length > 0 ||
      event.attendees.some((attendee) => !attendee.self)
    ) {
      store.setState((current) => ({
        ...current,
        confirmation: { event, kind: "move", time },
      }));
      return;
    }
    try {
      await data.mutation.mutateAsync({
        changes: { time },
        event,
        kind: "update",
      });
    } catch {
      // The mutation reports the failure.
    }
  };
  const confirm = async () => {
    const { confirmation } = ui;
    if (!confirmation) {
      return;
    }
    try {
      if (confirmation.kind === "delete") {
        await data.mutation.mutateAsync({
          event: confirmation.event,
          kind: "delete",
        });
        closeEvent();
      } else {
        await data.mutation.mutateAsync({
          changes: { time: confirmation.time },
          event: confirmation.event,
          kind: "update",
        });
      }
      store.setState((current) => ({ ...current, confirmation: null }));
    } catch {
      // The mutation reports the failure.
    }
  };
  const eventsByKey = new Map(
    data.events.map((event) => [getCalendarEventKey(event), event])
  );
  const filteredEvents = useMemo(() => {
    const search = ui.search.toLocaleLowerCase();
    return search === ""
      ? data.events
      : data.events.filter((event) =>
          `${event.title} ${event.location} ${event.description}`
            .toLocaleLowerCase()
            .includes(search)
        );
  }, [data.events, ui.search]);
  const selectedAccount = data.accounts.find(
    (account) => account.id === (selectedRef ?? requestedEventRef)?.connectionId
  );
  const selectedNeedsAccess =
    selectedAccount !== undefined && selectedAccount.status !== "connected";
  const selectedLoading =
    online &&
    !selectedNeedsAccess &&
    (selectedRef ? selectedQuery.isPending : data.isLoading);
  let selectedDescription =
    "This event may have moved or you may no longer have access.";
  if (selectedLoading) {
    selectedDescription = "Getting the latest event details.";
  } else if (selectedNeedsAccess) {
    selectedDescription =
      "Reconnect this mailbox in the sidebar to view this event.";
  } else if (!online) {
    selectedDescription =
      "This event is not saved on this device. Connect to load its details.";
  }
  const selectedEditor =
    ui.editor?.kind === "edit" &&
    selectedEvent &&
    ui.editor.event.connectionId === selectedEvent.connectionId &&
    ui.editor.event.calendarId === selectedEvent.calendarId &&
    (ui.editor.event.eventId === selectedEvent.eventId ||
      ui.editor.event.eventId === selectedEvent.recurringEventId)
      ? {
          ...ui.editor,
          event: data.displayEvent(
            preview ? ui.editor.event : (editingQuery.data ?? ui.editor.event)
          ),
        }
      : null;
  const activeEditor: CalendarEditor | null =
    (ui.editor?.kind === "create" ? ui.editor : selectedEditor) ??
    (selectedEvent?.permissions.edit === true
      ? {
          event: selectedEvent,
          kind: "edit",
          scope:
            selectedEvent.recurrence.length > 0 &&
            !selectedEvent.recurringEventId
              ? "series"
              : "occurrence",
        }
      : null);
  let editorKey: string | null = null;
  if (activeEditor) {
    editorKey =
      activeEditor.kind === "edit"
        ? `${getCalendarEventKey(activeEditor.event)}-${activeEditor.scope}`
        : activeEditor.operationId;
  }
  if (editorKey !== (editorSession?.key ?? null)) {
    setEditorSession(
      activeEditor && editorKey
        ? {
            key: editorKey,
            store: createCalendarEventEditorStore(activeEditor, timeZone),
          }
        : null
    );
  }
  const draftStore =
    activeEditor?.kind === "create" && editorSession?.key === editorKey
      ? editorSession.store
      : null;
  const subscribeToDraft = useCallback(
    (notify: () => void) => {
      const subscription = draftStore?.subscribe(notify);
      return () => {
        subscription?.unsubscribe();
      };
    },
    [draftStore]
  );
  const getDraftSnapshot = useCallback(
    () => draftStore?.get().values ?? null,
    [draftStore]
  );
  const draftForm = useSyncExternalStore(
    subscribeToDraft,
    getDraftSnapshot,
    getDraftSnapshot
  );
  const draftId =
    activeEditor?.kind === "create"
      ? `draft:${activeEditor.operationId}`
      : undefined;
  const { items, previewIssue } = useMemo(
    () =>
      getCalendarSchedule({
        calendars: data.calendars,
        dates: range.dates,
        draft:
          draftForm && draftId ? { form: draftForm, id: draftId } : undefined,
        events: filteredEvents,
        timeZone,
      }),
    [data.calendars, range.dates, draftForm, draftId, filteredEvents, timeZone]
  );
  let details: ReactNode = null;
  if (activeEditor && editorSession) {
    details = (
      <CalendarEventEditor
        calendars={data.calendars}
        events={data.events}
        editor={activeEditor}
        locationSuggestions={data.events.flatMap((event) =>
          event.location ? [event.location] : []
        )}
        previewIssue={previewIssue}
        key={
          activeEditor.kind === "edit"
            ? `${getCalendarEventKey(activeEditor.event)}-${activeEditor.scope}`
            : activeEditor.operationId
        }
        onClose={closeEvent}
        onDelete={
          activeEditor.kind === "edit" && activeEditor.event.permissions.delete
            ? () => {
                requestDelete(activeEditor.event);
              }
            : undefined
        }
        onReload={reloadEvent}
        onRespond={
          activeEditor.kind === "edit"
            ? async (event, response) => {
                const result = await data.mutation
                  .mutateAsync({ event, kind: "respond", response })
                  .catch(() => null);
                return result?.event;
              }
            : undefined
        }
        onSave={async ({ draft, editor, ref, original }) => {
          let result: CalendarMutationResult;
          if (editor.kind === "create") {
            result = await data.mutation.mutateAsync({
              draft,
              kind: "create",
              operationId: editor.operationId,
              ref,
            });
          } else {
            const changes = createCalendarEventChanges({
              draft,
              original: original ?? editor.event,
            });
            if (!changes) {
              return editor.event;
            }
            result = await data.mutation.mutateAsync({
              changes,
              event: editor.event,
              kind: "update",
            });
          }
          if (result.event) {
            selectEvent(result.event);
          }
          return result.event;
        }}
        onScopeChange={
          selectedEvent?.recurringEventId
            ? async (scope) => {
                store.setState((current) => ({
                  ...current,
                  loadingSeries: true,
                }));
                try {
                  const event =
                    scope === "series"
                      ? await reloadEvent({
                          ...selectedEvent,
                          eventId:
                            selectedEvent.recurringEventId ??
                            selectedEvent.eventId,
                        })
                      : selectedEvent;
                  store.setState((current) => ({
                    ...current,
                    editor: { event, kind: "edit", scope },
                    loadingSeries: false,
                  }));
                } catch (error) {
                  store.setState((current) => ({
                    ...current,
                    loadingSeries: false,
                  }));
                  toastError(error, { boundary: "calendar" });
                }
              }
            : undefined
        }
        pending={data.mutation.isPending || ui.loadingSeries}
        preview={preview !== null}
        store={editorSession.store}
        timeZone={timeZone}
        userId={userId}
      />
    );
  } else if (selectedEvent) {
    details = (
      <CalendarEventDetails
        calendarName={
          data.calendars.find(
            (calendar) =>
              calendar.connectionId === selectedEvent.connectionId &&
              calendar.calendarId === selectedEvent.calendarId
          )?.name ?? "Calendar"
        }
        event={selectedEvent}
        onClose={closeEvent}
        onDelete={() => {
          requestDelete(selectedEvent);
        }}
        onRespond={(response) => {
          data.mutation.mutate({
            event: selectedEvent,
            kind: "respond",
            response,
          });
        }}
        pending={data.mutation.isPending}
        timeZone={timeZone}
      />
    );
  } else if (requestedEventRef) {
    details = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-5 py-4">
          <Text as="h2" className="flex-1" size="lg" truncate weight="medium">
            Event details
          </Text>
          <IconButtonTooltip label="Close event details">
            <Button
              aria-label="Close event details"
              onClick={closeEvent}
              size="icon-sm"
              variant="ghost"
            >
              <Icon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>
        <div aria-live="polite" className="flex-1 space-y-2 p-5">
          {selectedLoading ? (
            <Icon
              aria-hidden
              animation="spin"
              icon={Loading03Icon}
              tone="muted"
            />
          ) : null}
          <Text as="h3" size="sm" weight="medium">
            {selectedLoading ? "Loading event" : "Event unavailable"}
          </Text>
          <Text as="p" size="sm" tone="muted">
            {selectedDescription}
          </Text>
        </div>
        <div className="p-5">
          <ActionFooter>
            <Button
              onClick={closeEvent}
              variant={
                selectedLoading || selectedNeedsAccess || !online
                  ? "default"
                  : "secondary"
              }
            >
              Close
            </Button>
            {!selectedLoading && !selectedNeedsAccess && online ? (
              <Button
                onClick={() => {
                  if (selectedRef) {
                    void selectedQuery.refetch();
                  } else {
                    void data.refresh();
                  }
                }}
                pending={
                  selectedQuery.isFetching ||
                  (!selectedRef && data.isRefreshing)
                }
              >
                Retry
              </Button>
            ) : null}
          </ActionFooter>
        </div>
      </div>
    );
  }
  const showInitialLoading = data.isLoading && !requestedEventRef;
  let emptyDescription =
    "Your Gmail mailbox includes your calendars. Connect it to see your schedule.";
  let emptyTitle = "Your day, in one place";
  if (!online) {
    emptyDescription =
      "No calendars are saved on this device. Connect to load your schedule.";
    emptyTitle = "You're offline";
  } else if (data.isLoading) {
    emptyDescription = "Your calendar will appear here.";
    emptyTitle = "Loading your calendars";
  } else if (data.failures.length > 0) {
    emptyDescription =
      "We could not load your calendars. Use Retry above to try again.";
  } else if (!data.isConfigured) {
    emptyDescription =
      "Calendar connection is not available in this environment.";
  }
  let syncStatus = "Calendar cached on this device, refreshes automatically.";
  if (preview) {
    syncStatus = "Sample events stay in this preview.";
  } else if (!online) {
    syncStatus = "Showing saved calendar data. Connect to refresh.";
  } else if (data.isLoading) {
    syncStatus = "Loading calendar events...";
  } else if (data.isRefreshing) {
    syncStatus = "Updating your cached calendar...";
  }
  let confirmationTitle = "Move this event?";
  let confirmationDescription = "";
  let confirmationAction = "Move event";
  if (ui.confirmation?.kind === "delete") {
    confirmationTitle =
      ui.confirmation.scope === "series"
        ? "Delete the entire series?"
        : "Delete this event?";
    confirmationDescription = `${ui.confirmation.event.title || "This event"} will be deleted${ui.confirmation.scope === "series" ? " and all its occurrences removed" : ""}.${ui.confirmation.event.attendees.some((guest) => !guest.self) ? " Guests will be notified." : ""}`;
    confirmationAction = "Delete event";
  } else if (ui.confirmation?.kind === "move") {
    confirmationDescription = `This changes ${ui.confirmation.event.recurringEventId || ui.confirmation.event.recurrence.length > 0 ? "this occurrence only" : "the event time"}.${ui.confirmation.event.attendees.some((guest) => !guest.self) ? " Guests will be notified." : ""}`;
  }
  const rangeHeading = new Intl.DateTimeFormat(undefined, {
    month: "long",
    timeZone,
    year: "numeric",
  }).format(
    new Date(calendarWallTimeToInstant({ date, time: "12:00", timeZone }))
  );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <CalendarSidebar
        accounts={data.accounts}
        calendars={data.calendars}
        canCreate={writableCalendars.length > 0}
        date={date}
        hiddenCalendarKeys={data.hiddenCalendarKeys}
        isConfigured={data.isConfigured}
        isMobileOpen={isMobileSidebarOpen}
        onConnect={(target) => {
          void connect(target);
        }}
        onCreate={() => {
          createEvent({ allDay: false, date, minute: 540 });
        }}
        onDateChange={(nextDate) => {
          void setMailboxSearch({ calendarDate: nextDate });
        }}
        onMobileOpenChange={onMobileSidebarOpenChange}
        onToggleCalendar={(calendar: CalendarSummary) => {
          const hiddenCalendarKeys = toggleCalendarGroupVisibility({
            calendar,
            groups: data.calendarGroups,
            hiddenCalendarKeys: ui.hiddenCalendarKeys,
          });
          store.setState((current) => ({ ...current, hiddenCalendarKeys }));
          if (
            selectedRef &&
            calendar.calendarId === selectedRef.calendarId &&
            hiddenCalendarKeys.includes(getCalendarRefKey(selectedRef))
          ) {
            closeEvent();
          }
          try {
            window.localStorage.setItem(
              preferencesKey,
              JSON.stringify({ hiddenCalendarKeys })
            );
          } catch {
            // Persistence is optional.
          }
        }}
        preview={preview !== null}
        pendingConnection={ui.pendingConnection}
        onUpdateCalendarColor={async (calendar, color) =>
          await data.colorMutation.mutateAsync({ calendar, color }).then(
            () => true,
            () => false
          )
        }
        pendingCalendarColorKey={
          data.colorMutation.isPending
            ? getCalendarRefKey(data.colorMutation.variables.calendar)
            : null
        }
      />
      <WorkspaceSection
        aria-label="Calendar workspace"
        className="flex"
        layout="cell"
      >
        <MobileHeader
          leading="sidebar"
          onLeadingClick={() => {
            onMobileSidebarOpenChange(true);
          }}
          title="Calendar"
        />
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Text
              as="h2"
              className="mr-2 min-w-0"
              size="lg"
              truncate
              weight="medium"
            >
              <LazyMotion features={domAnimation}>
                <m.span
                  {...getAppPresenceMotion({ distance: 4, reducedMotion })}
                  className="block truncate"
                  key={rangeHeading}
                >
                  {rangeHeading}
                </m.span>
              </LazyMotion>
            </Text>
            <div className="flex items-center gap-1">
              <IconButtonTooltip label="Previous date range">
                <Button
                  aria-label="Previous date range"
                  onClick={() => {
                    const offset = -{ agenda: 30, day: 1, month: 1, week: 7 }[
                      view
                    ];
                    const shifted = new Date(`${date}T12:00:00Z`);
                    if (view === "month") {
                      shifted.setUTCDate(1);
                      shifted.setUTCMonth(shifted.getUTCMonth() - 1);
                    }
                    void setMailboxSearch({
                      calendarDate:
                        view === "month"
                          ? shifted.toISOString().slice(0, 10)
                          : addCalendarDays(date, offset),
                    });
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Icon aria-hidden icon={ArrowLeft01Icon} />
                </Button>
              </IconButtonTooltip>
              <IconButtonTooltip label="Next date range">
                <Button
                  aria-label="Next date range"
                  onClick={() => {
                    const offset = { agenda: 30, day: 1, month: 1, week: 7 }[
                      view
                    ];
                    const shifted = new Date(`${date}T12:00:00Z`);
                    if (view === "month") {
                      shifted.setUTCDate(1);
                      shifted.setUTCMonth(shifted.getUTCMonth() + 1);
                    }
                    void setMailboxSearch({
                      calendarDate:
                        view === "month"
                          ? shifted.toISOString().slice(0, 10)
                          : addCalendarDays(date, offset),
                    });
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Icon aria-hidden icon={ArrowRight01Icon} />
                </Button>
              </IconButtonTooltip>
            </div>
            <Button
              onClick={() => {
                void setMailboxSearch({ calendarDate: now.date });
              }}
              size="sm"
              variant="secondary"
            >
              Today
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select
              items={viewOptions}
              onValueChange={(value) => {
                if (
                  value === "day" ||
                  value === "week" ||
                  value === "month" ||
                  value === "agenda"
                ) {
                  void setMailboxSearch({ calendarView: value });
                }
              }}
              value={view}
            >
              <SelectTrigger
                aria-label="Calendar view"
                className="w-24"
                size="sm"
                variant="ghost"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {viewOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CalendarTimeZonePicker
              aria-label="Display time zone"
              className="max-w-40"
              onValueChange={(zone) => {
                void setMailboxSearch({ calendarTimeZone: zone });
              }}
              size="sm"
              value={timeZone}
              variant="ghost"
            />
            <Popover>
              <IconButtonTooltip
                label={ui.search ? `Find events: ${ui.search}` : "Find events"}
              >
                <PopoverTrigger
                  render={
                    <Button
                      aria-label="Find events"
                      size="icon-sm"
                      variant={ui.search ? "secondary" : "ghost"}
                    />
                  }
                >
                  <Icon aria-hidden icon={Search01Icon} />
                </PopoverTrigger>
              </IconButtonTooltip>
              <PopoverContent align="end">
                <Input
                  aria-label="Find events in this view"
                  onChange={(event) => {
                    store.setState((current) => ({
                      ...current,
                      search: event.target.value,
                    }));
                  }}
                  placeholder="Find in this view"
                  size="sm"
                  type="search"
                  value={ui.search}
                />
              </PopoverContent>
            </Popover>
            <IconButtonTooltip label="Refresh calendars">
              <Button
                aria-label="Refresh calendars"
                disabled={preview !== null || data.isRefreshing}
                onClick={() => {
                  void data.refresh();
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Icon aria-hidden icon={RefreshIcon} />
              </Button>
            </IconButtonTooltip>
            {assistant && !assistant.open ? (
              <IconButtonTooltip label="Open assistant">
                <Button
                  aria-controls={assistant.panelId}
                  aria-expanded={assistant.open}
                  aria-label="Open assistant"
                  data-assistant-launcher
                  onClick={(event) => {
                    assistant.onOpen(event.currentTarget);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Icon aria-hidden icon={LayoutRightIcon} />
                </Button>
              </IconButtonTooltip>
            ) : null}
            {!preview && !online ? (
              <Pill size="xs" tone="orange">
                Offline
              </Pill>
            ) : null}
          </div>
          <p aria-live="polite" className="sr-only">
            {syncStatus}
          </p>
        </header>
        {data.failures.length > 0 ? (
          <output className="flex items-center gap-3 border-b border-border px-5 py-2">
            <p className="flex-1 text-caption text-muted-fg">
              Some calendars could not refresh. Saved events may be out of date.
            </p>
            <Button
              onClick={() => {
                void data.retryFailures();
              }}
              pending={data.retryingFailures}
              size="sm"
              variant="secondary"
            >
              Retry
            </Button>
          </output>
        ) : null}
        <div className="flex min-h-0 flex-1" ref={workspaceRef}>
          {data.accounts.length === 0 && !requestedEventRef ? (
            <EmptyMessageState
              action={
                !data.isLoading && data.isConfigured ? (
                  <Button
                    disabled={ui.pendingConnection !== null}
                    onClick={() => {
                      void connect({ kind: "add", source: "empty" });
                    }}
                    pending={
                      ui.pendingConnection?.kind === "add" &&
                      ui.pendingConnection.source === "empty"
                    }
                  >
                    Connect Gmail
                  </Button>
                ) : undefined
              }
              description={emptyDescription}
              title={emptyTitle}
            />
          ) : null}
          {data.accounts.length > 0 && showInitialLoading ? (
            <EmptyMessageState
              description="Your schedule will appear here."
              title="Loading your calendars"
            />
          ) : null}
          {data.accounts.length > 0 &&
          data.visibleCalendars.length === 0 &&
          !data.isLoading ? (
            <EmptyMessageState
              action={
                <Button
                  className="lg:hidden"
                  onClick={() => {
                    onMobileSidebarOpenChange(true);
                  }}
                >
                  Choose calendars
                </Button>
              }
              description={
                data.accounts.some((account) => account.status !== "connected")
                  ? "Manage the mailbox connection in the sidebar to see its calendars."
                  : "Choose a calendar in the sidebar to see its events."
              }
              title={
                data.accounts.some((account) => account.status !== "connected")
                  ? "Your mailbox needs attention"
                  : "No calendars visible"
              }
            />
          ) : null}
          {data.accounts.length > 0 &&
          data.visibleCalendars.length > 0 &&
          !showInitialLoading ? (
            <Schedule
              currentMinute={
                Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5))
              }
              dates={range.dates}
              items={items}
              onEventClick={(key) => {
                const event = eventsByKey.get(key);
                if (event) {
                  selectEvent(event);
                }
              }}
              onEventMove={({
                allDay,
                date: targetDate,
                id,
                minute,
                source,
              }) => {
                const event = eventsByKey.get(id);
                if (!event || data.mutation.isPending) {
                  return;
                }
                try {
                  let time = moveCalendarEventTime({
                    date: targetDate,
                    minute,
                    source,
                    time: event.time,
                    timeZone,
                  });
                  if (allDay && time.kind === "timed") {
                    time = {
                      endDate: addCalendarDays(targetDate, 1),
                      kind: "all-day",
                      startDate: targetDate,
                    };
                  } else if (!allDay && time.kind === "all-day") {
                    const start = calendarWallTimeToInstant({
                      date: targetDate,
                      time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
                      timeZone,
                    });
                    time = {
                      end: new Date(
                        Date.parse(start) + 60 * 60 * 1000
                      ).toISOString(),
                      kind: "timed",
                      start,
                      timeZone,
                    };
                  }
                  void applyTime(event, time);
                } catch (error) {
                  toastError(
                    {
                      message:
                        error instanceof Error
                          ? error.message
                          : "Choose a valid event time.",
                      status: 400,
                    },
                    { boundary: "calendar" }
                  );
                }
              }}
              onEventResize={({ date: endDate, endMinute, id }) => {
                const event = eventsByKey.get(id);
                if (
                  !event ||
                  event.time.kind !== "timed" ||
                  data.mutation.isPending
                ) {
                  return;
                }
                try {
                  const end = calendarWallTimeToInstant({
                    date:
                      endMinute === 1440
                        ? addCalendarDays(endDate, 1)
                        : endDate,
                    time:
                      endMinute === 1440
                        ? "00:00"
                        : `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`,
                    timeZone,
                  });
                  if (Date.parse(end) <= Date.parse(event.time.start)) {
                    throw new Error("The event must end after it starts.");
                  }
                  void applyTime(event, { ...event.time, end });
                } catch (error) {
                  toastError(
                    {
                      message:
                        error instanceof Error
                          ? error.message
                          : "Choose a valid end time.",
                      status: 400,
                    },
                    { boundary: "calendar" }
                  );
                }
              }}
              onSlotCreate={createEvent}
              onEmptyClick={closeEvent}
              selectedDate={date}
              selectedId={
                draftId ??
                (selectedEvent ? getCalendarEventKey(selectedEvent) : undefined)
              }
              today={now.date}
              view={view}
            />
          ) : null}
          {wide ? (
            <aside
              aria-label="Event details"
              className="ml-auto flex w-88 shrink-0 flex-col border-l border-border/50"
            >
              {details && activeEditor?.kind === "create" ? (
                <div
                  className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    entranceMotionVariants()
                  )}
                  key={activeEditor.operationId}
                >
                  {details}
                </div>
              ) : (
                (details ?? (
                  <LazyMotion features={domAnimation}>
                    <EmptyMessageState
                      title="No event selected"
                      description="Select an event to view its details. Double-click an empty time or drag across the calendar to create one."
                    />
                  </LazyMotion>
                ))
              )}
            </aside>
          ) : null}
        </div>
      </WorkspaceSection>
      {!wide && details && !ui.recurringAction && !ui.confirmation ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              closeEvent();
            }
          }}
          open
        >
          <DialogContent>
            <div className="sr-only">
              <DialogHeader>
                <DialogTitle>Event details</DialogTitle>
                <DialogDescription>
                  View and manage your calendar event.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex h-[80dvh] min-h-0 flex-col">{details}</div>
          </DialogContent>
        </Dialog>
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !ui.loadingSeries) {
            store.setState((current) => ({
              ...current,
              recurringAction: null,
            }));
          }
        }}
        open={ui.recurringAction !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Repeating event</AlertDialogTitle>
            <AlertDialogDescription>
              {ui.recurringAction?.recurringEventId
                ? "Choose whether to delete this occurrence or the entire series."
                : "You are viewing the recurring series. Changes apply to the entire series."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={ui.loadingSeries}
              onClick={() => {
                store.setState((current) => ({
                  ...current,
                  recurringAction: null,
                }));
              }}
              variant="secondary"
            >
              Cancel
            </Button>
            {ui.recurringAction?.recurringEventId ? (
              <Button
                disabled={ui.loadingSeries}
                onClick={() => {
                  void chooseRecurrenceScope("occurrence");
                }}
                variant="destructive"
              >
                This event
              </Button>
            ) : null}
            <Button
              onClick={() => {
                void chooseRecurrenceScope("series");
              }}
              pending={ui.loadingSeries}
              variant="destructive"
            >
              Entire series
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !data.mutation.isPending) {
            store.setState((current) => ({ ...current, confirmation: null }));
          }
        }}
        open={ui.confirmation !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmationTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={data.mutation.isPending}
              onClick={() => {
                store.setState((current) => ({
                  ...current,
                  confirmation: null,
                }));
              }}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void confirm();
              }}
              pending={data.mutation.isPending}
              variant={
                ui.confirmation?.kind === "move" ? "default" : "destructive"
              }
            >
              {confirmationAction}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export const CalendarWorkspace = (props: CalendarWorkspaceProps) => {
  const preview = usePreviewPersona();
  return (
    <CalendarWorkspaceContent
      {...props}
      key={`${props.userId}:${preview ?? "live"}`}
      preview={preview}
    />
  );
};
