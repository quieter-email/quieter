"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import { MobileHeader } from "@quieter/app/components/mobile-header";
import { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import { useMailboxRouteSearch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { clearCalendarConnectionCache } from "@quieter/app/lib/calendar-cache-lifecycle";
import {
  calendarEventQueryOptions,
  calendarEventsQueryOptions,
  getCalendarCacheMonthRanges,
  getCalendarQueryKey,
} from "@quieter/app/lib/calendar-query";
import { openConnectorLink } from "@quieter/app/lib/connectors-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { usePreviewPersona } from "@quieter/app/lib/preview-personas";
import type {
  CalendarAccount,
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
  splitCalendarEventTime,
} from "@quieter/calendar/time";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Pill } from "@quieter/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Schedule } from "@quieter/ui/schedule";
import type { ScheduleItem } from "@quieter/ui/schedule";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";

import {
  addCalendarDays,
  createCalendarEventChanges,
  getCalendarEventKey,
  getCalendarRefKey,
  getCalendarTimeZoneOptions,
} from "../domain/calendar-event-form";
import type { CalendarEditor } from "../domain/calendar-event-form";
import { CalendarEventDetails } from "./calendar-event-details";
import { CalendarEventEditor } from "./calendar-event-editor";
import { CalendarSidebar } from "./calendar-sidebar";
import { useCalendarData } from "./use-calendar-data";

type CalendarConfirmation =
  | { kind: "delete"; event: CalendarEvent; scope: "occurrence" | "series" }
  | { kind: "move"; event: CalendarEvent; time: CalendarEventTime }
  | { kind: "disconnect"; account: CalendarAccount };

type CalendarUiState = {
  confirmation: CalendarConfirmation | null;
  connecting: boolean;
  disconnecting: boolean;
  editor: CalendarEditor | null;
  hiddenCalendarKeys: string[];
  loadingSeries: boolean;
  recurringAction: { event: CalendarEvent; kind: "edit" | "delete" } | null;
  search: string;
};

type CalendarWorkspaceProps = {
  userId: string;
  isMobileSidebarOpen: boolean;
  onMobileSidebarOpenChange: (open: boolean) => void;
  onBackToMail: () => void;
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
  onBackToMail,
  onMobileSidebarOpenChange,
  userId,
  preview,
}: CalendarWorkspaceProps & { preview: string | null }) => {
  const route = useMailboxRouteSearch();
  const queryClient = useQueryClient();
  const agentWorkspace = useAgentWorkspace();
  const online = useSyncExternalStore(
    subscribeToOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  );
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect((): (() => void) | undefined => {
    const element = workspaceRef.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWide((entry?.contentRect.width ?? 0) >= 1120);
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
    () => getCalendarRange({ date, timeZone, view }),
    [date, timeZone, view]
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
    connecting: false,
    disconnecting: false,
    editor: null,
    hiddenCalendarKeys: initialPreferences,
    loadingSeries: false,
    recurringAction: null,
    search: "",
  });
  const ui = useSelector(store, (current) => current);
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
  const selectedRef =
    route.calendarConnectionId &&
    route.calendarId &&
    route.calendarEventId &&
    data.visibleCalendars.some(
      (calendar) =>
        calendar.connectionId === route.calendarConnectionId &&
        calendar.calendarId === route.calendarId
    )
      ? {
          calendarId: route.calendarId,
          connectionId: route.calendarConnectionId,
          eventId: route.calendarEventId,
        }
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
    enabled: preview === null && selectedRef !== undefined,
    initialData: () =>
      selectedRef
        ? data.events.find(
            (event) =>
              getCalendarEventKey(event) === getCalendarEventKey(selectedRef)
          )
        : undefined,
    persister: preview ? undefined : selectedOptions.persister,
    queryKey: preview
      ? ["calendar-preview", userId, preview, "event", selectedRef]
      : selectedOptions.queryKey,
  });
  let selectedEvent: CalendarEvent | undefined;
  if (selectedRef) {
    selectedEvent = preview
      ? data.events.find(
          (event) =>
            getCalendarEventKey(event) === getCalendarEventKey(selectedRef)
        )
      : selectedQuery.data;
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
  const setRoute = useEffectEvent(route.setMailboxSearch);
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
    void route.setMailboxSearch({ calendarEventId: null });
  };
  const selectEvent = (event: CalendarEvent) => {
    void route.setMailboxSearch({
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
    minute,
  }: {
    allDay: boolean;
    date: string;
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
            end: new Date(Date.parse(start) + 60 * 60 * 1000).toISOString(),
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
  const connect = async () => {
    store.setState((current) => ({ ...current, connecting: true }));
    try {
      await openConnectorLink({
        provider: "google_calendar",
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
    } catch (error) {
      toastError(error, { boundary: "calendar" });
    } finally {
      store.setState((current) => ({ ...current, connecting: false }));
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
  const requestAction = (event: CalendarEvent, kind: "edit" | "delete") => {
    if (event.recurringEventId || event.recurrence.length > 0) {
      store.setState((current) => ({
        ...current,
        recurringAction: { event, kind },
      }));
    } else if (kind === "edit") {
      store.setState((current) => ({
        ...current,
        editor: { event, kind: "edit", scope: "occurrence" },
      }));
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
              ...action.event,
              eventId: action.event.recurringEventId ?? action.event.eventId,
            })
          : action.event;
      store.setState((current) => ({
        ...current,
        confirmation:
          action.kind === "delete" ? { event, kind: "delete", scope } : null,
        editor: action.kind === "edit" ? { event, kind: "edit", scope } : null,
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
    if (confirmation.kind === "disconnect") {
      store.setState((current) => ({ ...current, disconnecting: true }));
      try {
        await rpc.connectors.disconnect({
          connectionId: confirmation.account.id,
          provider: "google_calendar",
        });
        await clearCalendarConnectionCache(
          queryClient,
          userId,
          confirmation.account.id
        );
        store.setState((current) => ({
          ...current,
          confirmation: null,
          disconnecting: false,
        }));
        closeEvent();
        await queryClient.invalidateQueries({
          queryKey: getCalendarQueryKey(userId),
        });
        toast.success("Calendar account disconnected.");
      } catch (error) {
        store.setState((current) => ({ ...current, disconnecting: false }));
        toastError(error, { boundary: "calendar" });
      }
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
  const filteredEvents = data.events.filter((event) =>
    `${event.title} ${event.location} ${event.description}`
      .toLocaleLowerCase()
      .includes(ui.search.toLocaleLowerCase())
  );
  const items: ScheduleItem[] = filteredEvents.flatMap((event) => {
    const calendarIndex = data.calendars.findIndex(
      (calendar) =>
        calendar.connectionId === event.connectionId &&
        calendar.calendarId === event.calendarId
    );
    let tone: ScheduleItem["tone"] =
      (["blue", "green", "purple", "orange", "cyan"] as const)[
        Math.max(0, calendarIndex) % 5
      ] ?? "blue";
    if (event.status === "tentative") {
      tone = "warning";
    }
    return splitCalendarEventTime({
      dates: range.dates,
      time: event.time,
      timeZone,
    }).map((segment) => ({
      ...segment,
      detail: event.location,
      id: getCalendarEventKey(event),
      title: event.title || "Untitled event",
      tone,
    }));
  });
  const details = selectedEvent ? (
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
        requestAction(selectedEvent, "delete");
      }}
      onEdit={() => {
        requestAction(selectedEvent, "edit");
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
  ) : null;
  let emptyDescription =
    "Bring your schedule into Quieter and plan with your assistant.";
  if (data.isLoading) {
    emptyDescription = "Your calendar will appear here.";
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
  if (ui.confirmation?.kind === "disconnect") {
    confirmationTitle = "Disconnect calendar account?";
    confirmationDescription = `Calendars for ${ui.confirmation.account.email ?? ui.confirmation.account.name} will be removed from this device. Events remain in your calendar account.`;
    confirmationAction = "Disconnect";
  } else if (ui.confirmation?.kind === "delete") {
    confirmationTitle =
      ui.confirmation.scope === "series"
        ? "Delete the entire series?"
        : "Delete this event?";
    confirmationDescription = `${ui.confirmation.event.title || "This event"} will be deleted${ui.confirmation.scope === "series" ? " and all its occurrences removed" : ""}.${ui.confirmation.event.attendees.some((guest) => !guest.self) ? " Guests will be notified." : ""}`;
    confirmationAction = "Delete event";
  } else if (ui.confirmation?.kind === "move") {
    confirmationDescription = `This changes ${ui.confirmation.event.recurringEventId || ui.confirmation.event.recurrence.length > 0 ? "this occurrence only" : "the event time"}.${ui.confirmation.event.attendees.some((guest) => !guest.self) ? " Guests will be notified." : ""}`;
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <CalendarSidebar
        accounts={data.accounts}
        calendars={data.calendars}
        canCreate={writableCalendars.length > 0}
        connecting={ui.connecting}
        date={date}
        hiddenCalendarKeys={ui.hiddenCalendarKeys}
        isConfigured={data.isConfigured}
        isMobileOpen={isMobileSidebarOpen}
        onBackToMail={onBackToMail}
        onConnect={() => {
          void connect();
        }}
        onCreate={() => {
          createEvent({ allDay: false, date, minute: 540 });
        }}
        onDateChange={(nextDate) => {
          void route.setMailboxSearch({ calendarDate: nextDate });
        }}
        onDisconnect={(account) => {
          store.setState((current) => ({
            ...current,
            confirmation: { account, kind: "disconnect" },
          }));
        }}
        onMobileOpenChange={onMobileSidebarOpenChange}
        onToggleCalendar={(calendar: CalendarSummary) => {
          const key = getCalendarRefKey(calendar);
          const hiddenCalendarKeys = ui.hiddenCalendarKeys.includes(key)
            ? ui.hiddenCalendarKeys.filter((item) => item !== key)
            : [...ui.hiddenCalendarKeys, key];
          store.setState((current) => ({ ...current, hiddenCalendarKeys }));
          if (
            calendar.connectionId === selectedRef?.connectionId &&
            calendar.calendarId === selectedRef.calendarId &&
            hiddenCalendarKeys.includes(key)
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
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Text
            as="h2"
            className="min-w-0 flex-1 basis-32 sm:basis-auto"
            size="lg"
            truncate
            weight="medium"
          >
            {new Intl.DateTimeFormat(undefined, {
              month: "long",
              timeZone: "UTC",
              year: "numeric",
            }).format(new Date(`${date}T12:00:00Z`))}
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
                  void route.setMailboxSearch({
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
                  void route.setMailboxSearch({
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
              void route.setMailboxSearch({ calendarDate: now.date });
            }}
            size="sm"
            variant="secondary"
          >
            Today
          </Button>
          <Select
            items={viewOptions}
            onValueChange={(value) => {
              if (
                value === "day" ||
                value === "week" ||
                value === "month" ||
                value === "agenda"
              ) {
                void route.setMailboxSearch({ calendarView: value });
              }
            }}
            value={view}
          >
            <SelectTrigger
              aria-label="Calendar view"
              className="w-24"
              size="sm"
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
          <Select
            items={getCalendarTimeZoneOptions(timeZone)}
            onValueChange={(value) => {
              if (value) {
                void route.setMailboxSearch({ calendarTimeZone: value });
              }
            }}
            value={timeZone}
          >
            <SelectTrigger
              aria-label="Display time zone"
              className="max-w-32"
              size="sm"
              variant="ghost"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getCalendarTimeZoneOptions(timeZone).map((zone) => (
                <SelectItem key={zone.value} value={zone.value}>
                  {zone.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {!preview && !online ? (
            <Pill size="xs" tone="orange">
              Offline
            </Pill>
          ) : null}
          <p aria-live="polite" className="sr-only">
            {syncStatus}
          </p>
        </header>
        {data.failures.map((failure) => (
          <div
            className="flex items-center gap-3 border-b border-border px-5 py-2"
            key={failure.key}
          >
            <p className="flex-1 text-caption text-destructive">
              Could not refresh {failure.label}. Cached events may be out of
              date.
            </p>
            <Button
              onClick={() => {
                void failure.retry();
              }}
              size="sm"
              variant="secondary"
            >
              Retry
            </Button>
          </div>
        ))}
        <div className="flex min-h-0 flex-1" ref={workspaceRef}>
          {data.accounts.length === 0 ? (
            <EmptyMessageState
              action={
                !data.isLoading && data.isConfigured ? (
                  <Button
                    onClick={() => {
                      void connect();
                    }}
                    pending={ui.connecting}
                  >
                    Connect Google Calendar
                  </Button>
                ) : undefined
              }
              description={emptyDescription}
              title={
                data.isLoading
                  ? "Loading your calendars"
                  : "Your day, in one place"
              }
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
              description="Choose a calendar in the sidebar to see its events."
              title="No calendars visible"
            />
          ) : null}
          {data.accounts.length > 0 &&
          (data.visibleCalendars.length > 0 || data.isLoading) ? (
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
              onSlotClick={createEvent}
              selectedId={
                selectedEvent ? getCalendarEventKey(selectedEvent) : undefined
              }
              today={now.date}
              view={view}
            />
          ) : null}
          {wide && details ? (
            <aside
              aria-label="Event details"
              className="flex w-80 shrink-0 flex-col border-l border-border"
            >
              {details}
            </aside>
          ) : null}
        </div>
      </WorkspaceSection>
      {!wide &&
      selectedEvent &&
      !ui.editor &&
      !ui.recurringAction &&
      !ui.confirmation ? (
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
            <div className="flex max-h-[80dvh] flex-col">{details}</div>
          </DialogContent>
        </Dialog>
      ) : null}
      {selectedRef && selectedQuery.isError && !selectedEvent ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              closeEvent();
            }
          }}
          open
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Event unavailable</DialogTitle>
              <DialogDescription>
                This event may have moved or you may no longer have access.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={closeEvent} variant="secondary">
                Close
              </Button>
              <Button
                onClick={() => {
                  void selectedQuery.refetch();
                }}
              >
                Retry
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {ui.editor ? (
        <CalendarEventEditor
          calendars={data.calendars}
          editor={ui.editor}
          key={
            ui.editor.kind === "edit"
              ? `${getCalendarEventKey(ui.editor.event)}-${ui.editor.scope}`
              : ui.editor.operationId
          }
          onClose={() => {
            store.setState((current) => ({ ...current, editor: null }));
          }}
          onReload={reloadEvent}
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
                store.setState((current) => ({ ...current, editor: null }));
                return;
              }
              result = await data.mutation.mutateAsync({
                changes,
                event: editor.event,
                kind: "update",
              });
            }
            store.setState((current) => ({ ...current, editor: null }));
            if (result.event) {
              selectEvent(result.event);
            }
          }}
          pending={data.mutation.isPending}
          preview={preview !== null}
          timeZone={timeZone}
        />
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
              {ui.recurringAction?.event.recurringEventId
                ? `Choose whether to ${ui.recurringAction.kind === "delete" ? "delete" : "edit"} this occurrence or the entire series.`
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
            {ui.recurringAction?.event.recurringEventId ? (
              <Button
                disabled={ui.loadingSeries}
                onClick={() => {
                  void chooseRecurrenceScope("occurrence");
                }}
                variant={
                  ui.recurringAction?.kind === "delete"
                    ? "destructive"
                    : "secondary"
                }
              >
                This event
              </Button>
            ) : null}
            <Button
              onClick={() => {
                void chooseRecurrenceScope("series");
              }}
              pending={ui.loadingSeries}
              variant={
                ui.recurringAction?.kind === "delete"
                  ? "destructive"
                  : "default"
              }
            >
              Entire series
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !data.mutation.isPending && !ui.disconnecting) {
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
              disabled={data.mutation.isPending || ui.disconnecting}
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
              pending={data.mutation.isPending || ui.disconnecting}
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
