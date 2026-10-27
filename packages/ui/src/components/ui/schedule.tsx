"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { IconButtonTooltip } from "./icon-button-tooltip";

export type ScheduleItem = {
  allDay: boolean;
  color?: string;
  date: string;
  detail?: string;
  endMinute: number;
  id: string;
  preview?: true;
  startMinute: number;
  title: string;
  tone?:
    | "primary"
    | "success"
    | "warning"
    | "destructive"
    | "muted"
    | "blue"
    | "green"
    | "purple"
    | "orange"
    | "cyan";
};

export type ScheduleProps = {
  currentMinute?: number;
  dates: string[];
  items: ScheduleItem[];
  onEventClick: (id: string) => void;
  onEmptyClick?: () => void;
  onEventMove?: (input: {
    allDay: boolean;
    date: string;
    id: string;
    minute: number;
    source: { date: string; minute: number };
  }) => void;
  onEventResize?: (input: {
    date: string;
    endMinute: number;
    id: string;
  }) => void;
  onSlotCreate: (input: {
    allDay: boolean;
    date: string;
    endMinute?: number;
    minute: number;
  }) => void;
  selectedDate?: string;
  selectedId?: string;
  today: string;
  view: "day" | "week" | "month" | "agenda";
};

const hourHeight = 56;
type ScheduleStyle = CSSProperties & {
  "--schedule-columns"?: string;
  "--schedule-event-color"?: string;
  "--schedule-height"?: string;
  "--schedule-left"?: string;
  "--schedule-min-width"?: string;
  "--schedule-top"?: string;
  "--schedule-width"?: string;
};
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const minuteLabels = Array.from({ length: 96 }, (_, index) => index * 15);
const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  weekday: "long",
});
const weekdayFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "UTC",
  weekday: "short",
});
const toneClasses = {
  blue: "[--schedule-event-color:var(--q-blue)]",
  cyan: "[--schedule-event-color:var(--q-cyan)]",
  destructive: "[--schedule-event-color:var(--destructive)]",
  green: "[--schedule-event-color:var(--q-green)]",
  muted: "[--schedule-event-color:var(--muted-fg)]",
  orange: "[--schedule-event-color:var(--q-orange)]",
  primary: "[--schedule-event-color:var(--primary)]",
  purple: "[--schedule-event-color:var(--q-purple)]",
  success: "[--schedule-event-color:var(--success)]",
  warning: "[--schedule-event-color:var(--warning)]",
} satisfies Record<NonNullable<ScheduleItem["tone"]>, string>;

const formatMinute = (minute: number) => {
  const hour = Math.floor(minute / 60);
  const remainder = Math.floor(minute % 60);
  return `${String(hour).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const getSlotMinute = ({
  boundary,
  button,
  clientY,
}: {
  boundary: "start" | "end";
  button: HTMLButtonElement;
  clientY: number;
}) => {
  const bounds = button.parentElement?.getBoundingClientRect();
  if (!bounds) {
    return null;
  }
  const position = ((clientY - bounds.top) * 60) / hourHeight / 15;
  const minute =
    (boundary === "start" ? Math.floor(position) : Math.round(position)) * 15;
  return Math.max(0, Math.min(boundary === "start" ? 1425 : 1440, minute));
};

type PositionedItem = {
  column: number;
  columns: number;
  item: ScheduleItem;
};

type SlotSelection = {
  anchorMinute: number;
  date: string;
  minute: number;
  originY: number;
  phase: "pending" | "selecting";
  pointerId: number;
};

const positionTimedItems = (items: ScheduleItem[]): PositionedItem[] => {
  const sorted = items
    .filter((item) => !item.allDay)
    .toSorted(
      (left, right) =>
        left.startMinute - right.startMinute || right.endMinute - left.endMinute
    );
  const result: PositionedItem[] = [];
  let cluster: PositionedItem[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = 0;

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMinute >= clusterEnd) {
      for (const entry of cluster) {
        entry.columns = columnEnds.length;
      }
      result.push(...cluster);
      cluster = [];
      columnEnds = [];
    }

    const occupiedEndMinute = Math.max(
      item.endMinute,
      item.startMinute + (24 * 60) / hourHeight
    );
    const freeColumn = columnEnds.findIndex((end) => end <= item.startMinute);
    const column = freeColumn === -1 ? columnEnds.length : freeColumn;
    columnEnds[column] = occupiedEndMinute;
    cluster.push({ column, columns: 1, item });
    clusterEnd = Math.max(clusterEnd, occupiedEndMinute);
  }

  for (const entry of cluster) {
    entry.columns = columnEnds.length;
  }
  result.push(...cluster);
  return result;
};

export const Schedule = ({
  currentMinute,
  dates,
  items,
  onEventClick,
  onEmptyClick,
  onEventMove,
  onEventResize,
  onSlotCreate,
  selectedDate,
  selectedId,
  today,
  view,
}: ScheduleProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    allDay: boolean;
    date: string;
    id: string;
    minute: number;
    offsetMinute: number;
  } | null>(null);
  const slotHelpId = useId();
  const selectionRef = useRef<SlotSelection | null>(null);
  const suppressSlotClickRef = useRef(false);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [resize, setResize] = useState<{
    date: string;
    endMinute: number;
    id: string;
    originMinute: number;
    originY: number;
    startMinute: number;
  } | null>(null);

  const slotsByDate = useMemo(() => {
    if (view !== "day" && view !== "week") {
      return new Map<string, ReactNode>();
    }
    return new Map(
      dates.map((date) => {
        const dateLabel = dateFormatter.format(new Date(`${date}T12:00:00Z`));
        return [
          date,
          minuteLabels.map((minute) => {
            const slotStyle: ScheduleStyle = {
              "--schedule-top": `${(minute * hourHeight) / 60}px`,
            };
            return (
              <button
                aria-describedby={slotHelpId}
                aria-label={`Create event on ${dateLabel} at ${formatMinute(minute)}`}
                className={cn(
                  "absolute inset-x-0 top-[var(--schedule-top)] h-3.5 cursor-crosshair text-left outline-none hover:bg-control-hover focus-visible:z-10 focus-visible:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset",
                  {
                    "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:border-t before:border-border/50":
                      minute % 60 === 0,
                  }
                )}
                data-slot-date={date}
                data-slot-minute={minute}
                key={minute}
                style={slotStyle}
                tabIndex={date === dates[0] && minute === 540 ? 0 : -1}
                type="button"
              />
            );
          }),
        ] as const;
      })
    );
  }, [dates, slotHelpId, view]);

  const days = useMemo(() => {
    const grouped = new Map<string, ScheduleItem[]>(
      dates.map((date) => [date, []])
    );
    for (const item of items) {
      grouped.get(item.date)?.push(item);
    }
    for (const dayItems of grouped.values()) {
      dayItems.sort(
        (left, right) =>
          Number(right.allDay) - Number(left.allDay) ||
          left.startMinute - right.startMinute
      );
    }
    return grouped;
  }, [dates, items]);

  useEffect(() => {
    if ((view === "day" || view === "week") && scrollRef.current) {
      scrollRef.current.scrollTop = 7.75 * hourHeight;
    }
  }, [view]);

  const beginDrag = (
    event: DragEvent<HTMLButtonElement>,
    item: ScheduleItem,
    timed: boolean
  ) => {
    if (!onEventMove || item.preview) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      allDay: item.allDay,
      date: item.date,
      id: item.id,
      minute: item.startMinute,
      offsetMinute: timed
        ? Math.max(0, ((event.clientY - bounds.top) * 60) / hourHeight)
        : 0,
    };
    event.dataTransfer.setData("application/x-quieter-schedule-event", item.id);
    event.dataTransfer.effectAllowed = "move";
  };

  const dropEvent = (
    event: DragEvent<HTMLElement>,
    date: string,
    allDay: boolean,
    timed = false
  ) => {
    const dragged = dragRef.current;
    if (!dragged || !onEventMove) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const minute = timed
      ? Math.max(
          0,
          Math.min(
            1425,
            Math.round(
              (((event.clientY - bounds.top) * 60) / hourHeight -
                dragged.offsetMinute) /
                15
            ) * 15
          )
        )
      : dragged.minute;
    onEventMove({
      allDay,
      date,
      id: dragged.id,
      minute: allDay ? 0 : minute,
      source: { date: dragged.date, minute: dragged.minute },
    });
    dragRef.current = null;
  };

  const moveSlotFocus = (
    event: KeyboardEvent<HTMLDivElement>,
    date: string,
    minute: number
  ) => {
    let targetMinute = minute;
    let targetDate = date;
    switch (event.key) {
      case "ArrowUp": {
        targetMinute -= 15;
        break;
      }
      case "ArrowDown": {
        targetMinute += 15;
        break;
      }
      case "ArrowLeft": {
        targetDate = dates[dates.indexOf(date) - 1] ?? date;
        break;
      }
      case "ArrowRight": {
        targetDate = dates[dates.indexOf(date) + 1] ?? date;
        break;
      }
      case "Home": {
        targetMinute = 0;
        break;
      }
      case "End": {
        targetMinute = 1425;
        break;
      }
      case "PageUp": {
        targetMinute -= 120;
        break;
      }
      case "PageDown": {
        targetMinute += 120;
        break;
      }
      default: {
        return;
      }
    }
    event.preventDefault();
    scrollRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-slot-date="${targetDate}"][data-slot-minute="${Math.max(0, Math.min(1425, targetMinute))}"]`
      )
      ?.focus();
  };

  const renderEvent = (
    item: ScheduleItem,
    presentation: "timed" | "compact" | "agenda" = "timed"
  ) => {
    const compact = presentation !== "timed";
    const duration = item.endMinute - item.startMinute;
    // Calendar colors come from external calendars and cannot use fixed theme tokens.
    const externalColor =
      item.color && /^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(item.color)
        ? item.color
        : undefined;
    const eventColorStyle: ScheduleStyle | undefined = externalColor
      ? { "--schedule-event-color": externalColor }
      : undefined;
    return (
      // Schedule targets need data-sized geometry, drag anchors and dense event typography.
      // Shared Button sizes cannot express this timed positioning or month-row interaction.
      <button
        aria-label={`${item.title}, ${item.allDay ? "all day" : `${formatMinute(item.startMinute)} to ${formatMinute(item.endMinute)}`}. ${item.preview ? "Unsaved event preview." : "Open event to edit."}`}
        aria-pressed={item.preview ? undefined : selectedId === item.id}
        className={cn(
          "group/event @container/event-card relative z-10 flex w-full min-w-0 flex-col overflow-hidden rounded-sm bg-[color-mix(in_srgb,var(--schedule-event-color)_30%,var(--card))] px-2 py-1 text-left text-body-sm leading-4 text-fg transition-[color,background-color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg focus-visible:outline-hidden enabled:hover:brightness-95 data-selected:ring-2 data-selected:ring-primary motion-reduce:transition-none",
          !externalColor && toneClasses[item.tone ?? "primary"],
          {
            "h-full": !compact,
            "py-0.5": !compact && !item.allDay && duration < 60,
            "py-1 text-caption": compact,
            "transition-[opacity,scale] duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) motion-reduce:transition-opacity starting:scale-[0.98] starting:opacity-0 motion-reduce:starting:scale-100":
              item.preview,
          }
        )}
        data-selected={selectedId === item.id || undefined}
        disabled={item.preview}
        draggable={Boolean(onEventMove) && !item.preview}
        key={`${item.id}:${item.date}`}
        onClick={() => {
          if (item.preview) {
            return;
          }
          setExpandedDate(null);
          onEventClick(item.id);
        }}
        onDragEnd={() => {
          dragRef.current = null;
        }}
        onDragStart={(event) => {
          beginDrag(event, item, !compact && !item.allDay);
        }}
        style={eventColorStyle}
        title={`${item.title}${item.allDay ? "" : `, ${formatMinute(item.startMinute)} – ${formatMinute(item.endMinute)}`}${item.detail ? `, ${item.detail}` : ""}`}
        type="button"
      >
        <span
          className={cn("w-full shrink-0 font-medium", {
            "line-clamp-2": !compact && duration >= 75,
            truncate: compact || duration < 75,
          })}
        >
          {presentation === "compact" && !item.allDay ? (
            <span className="mr-1 font-normal">
              {formatMinute(item.startMinute)}
            </span>
          ) : null}
          {item.title}
        </span>
        {!compact && !item.allDay && duration >= 45 ? (
          <span className="w-full shrink-0 truncate text-micro">
            {formatMinute(item.startMinute)} – {formatMinute(item.endMinute)}
          </span>
        ) : null}
        {!compact && duration >= 90 && item.detail ? (
          <span className="hidden w-full shrink-0 truncate text-micro @min-[8rem]/event-card:block">
            {item.detail}
          </span>
        ) : null}
      </button>
    );
  };

  const renderAgendaDay = (date: string, dayItems: ScheduleItem[]) => (
    <section
      className={cn("border-b border-border/50 last:border-b-0", {
        "py-6": view === "agenda",
      })}
      data-selected-date={date === selectedDate || undefined}
      key={date}
    >
      {view === "agenda" ? (
        <h3
          className={cn("mb-4 text-body-sm font-medium", {
            "text-primary": date === today,
          })}
        >
          {dateFormatter.format(new Date(`${date}T12:00:00Z`))}
          {date === today ? (
            <span className="ml-2 text-caption font-normal">Today</span>
          ) : null}
          {date === selectedDate ? (
            <span className="sr-only">, selected date</span>
          ) : null}
        </h3>
      ) : null}
      <div className="space-y-2">
        {dayItems.length === 0 ? (
          <p className="text-caption text-muted-fg">No events on this day.</p>
        ) : null}
        {dayItems.map((item) => (
          <div
            className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3"
            key={`${item.id}:${date}`}
          >
            <p className="pt-1 text-caption text-muted-fg">
              {item.allDay ? "All day" : formatMinute(item.startMinute)}
            </p>
            {renderEvent(item, "agenda")}
          </div>
        ))}
      </div>
    </section>
  );

  if (view === "agenda") {
    const occupied = [...days].filter(
      ([date, dayItems]) => dayItems.length > 0 || date === selectedDate
    );
    return (
      <div
        aria-label="Calendar agenda"
        className="min-h-0 flex-1 overflow-y-auto px-5"
      >
        {occupied.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-body-sm text-muted-fg">
              No events in this date range.
            </p>
            {dates[0] ? (
              <Button
                onClick={() => {
                  onSlotCreate({
                    allDay: false,
                    date: dates[0] ?? today,
                    minute: 540,
                  });
                }}
              >
                Create event
              </Button>
            ) : null}
          </div>
        ) : (
          occupied.map(([date, dayItems]) => renderAgendaDay(date, dayItems))
        )}
      </div>
    );
  }

  if (view === "month") {
    const month = dates[20]?.slice(0, 7);
    return (
      <>
        <div
          aria-label="Month calendar"
          className="flex min-h-0 flex-1 flex-col overflow-auto"
        >
          <div className="grid min-w-xl grid-cols-7">
            {dates.slice(0, 7).map((date) => (
              <div className="px-3 py-3 text-caption text-muted-fg" key={date}>
                {weekdayFormatter.format(new Date(`${date}T12:00:00Z`))}
              </div>
            ))}
          </div>
          <div className="grid min-h-0 min-w-xl flex-1 auto-rows-[minmax(min-content,1fr)] grid-cols-7">
            {dates.map((date) => {
              const dayItems = (days.get(date) ?? []).toSorted(
                (left, right) =>
                  Number(Boolean(right.preview)) - Number(Boolean(left.preview))
              );
              const dateVariant = date === selectedDate ? "secondary" : "ghost";
              return (
                <div
                  className="min-h-28 min-w-0 border-t border-r border-border/50 px-2 py-3 nth-[7n]:border-r-0"
                  data-selected-date={date === selectedDate || undefined}
                  key={date}
                  role="presentation"
                  onClick={(event) => {
                    if (
                      event.target instanceof Element &&
                      !event.target.closest("button")
                    ) {
                      onEmptyClick?.();
                    }
                  }}
                  onDoubleClick={(event) => {
                    if (
                      event.target instanceof Element &&
                      !event.target.closest("button")
                    ) {
                      onSlotCreate({ allDay: true, date, minute: 0 });
                    }
                  }}
                  onDragOver={(event) => {
                    if (dragRef.current) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    dropEvent(event, date, dragRef.current?.allDay ?? false);
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <Button
                      aria-label={`Create event on ${dateFormatter.format(new Date(`${date}T12:00:00Z`))}`}
                      onClick={(event) => {
                        if (event.detail === 0) {
                          onSlotCreate({ allDay: true, date, minute: 0 });
                        } else if (event.detail === 1) {
                          onEmptyClick?.();
                        }
                      }}
                      onDoubleClick={() => {
                        onSlotCreate({ allDay: true, date, minute: 0 });
                      }}
                      size="compact"
                      variant={date === today ? "default" : dateVariant}
                    >
                      <span
                        className={cn({
                          "opacity-40": date.slice(0, 7) !== month,
                        })}
                      >
                        {Number(date.slice(8))}
                        {date === selectedDate ? (
                          <span className="sr-only">, selected date</span>
                        ) : null}
                      </span>
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {dayItems
                      .slice(0, 3)
                      .map((item) => renderEvent(item, "compact"))}
                    {dayItems.length > 3 ? (
                      <Button
                        onClick={() => {
                          setExpandedDate(date);
                        }}
                        size="compact"
                        variant="ghost"
                      >
                        +{dayItems.length - 3} more
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setExpandedDate(null);
            }
          }}
          open={expandedDate !== null}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {expandedDate
                  ? dateFormatter.format(new Date(`${expandedDate}T12:00:00Z`))
                  : "Day events"}
              </DialogTitle>
              <DialogDescription>
                Choose an event to see details or edit its schedule.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="max-h-96 overflow-y-auto">
              {expandedDate
                ? renderAgendaDay(expandedDate, days.get(expandedDate) ?? [])
                : null}
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton variant="default">Done</DialogCloseButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  const columnStyle: ScheduleStyle = {
    "--schedule-columns": `3rem repeat(${dates.length}, minmax(6.5rem, 1fr))`,
    "--schedule-min-width": `${48 + dates.length * 104}px`,
  };
  const currentTimeStyle: ScheduleStyle = {
    "--schedule-top": `${((currentMinute ?? 0) * hourHeight) / 60}px`,
  };
  const selectionStart = selection
    ? Math.min(selection.anchorMinute, selection.minute)
    : 0;
  const selectionEnd = selection
    ? Math.max(selectionStart + 15, selection.anchorMinute, selection.minute)
    : 0;
  const selectionStyle: ScheduleStyle = {
    "--schedule-height": `${((selectionEnd - selectionStart) * hourHeight) / 60}px`,
    "--schedule-top": `${(selectionStart * hourHeight) / 60}px`,
  };
  return (
    <div
      aria-label={`${view === "day" ? "Day" : "Week"} calendar`}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-bg-raised"
      ref={scrollRef}
    >
      <p className="sr-only" id={slotHelpId}>
        Drag to choose a time range, or double-click to create an event. Use
        arrow keys to choose a time in 15-minute steps and Enter to create an
        event. Press Escape to cancel a selection. Open any event to edit its
        date and time.
      </p>
      <div
        className="sticky top-0 z-30 grid w-full min-w-[var(--schedule-min-width)] grid-cols-[var(--schedule-columns)] border-b border-border/50 bg-bg-raised"
        style={columnStyle}
      >
        <div className="border-r border-border/50" />
        {dates.map((date, index) => (
          <div
            className={cn(
              "flex min-h-8 items-center justify-center gap-1.5 border-border/50 px-2 py-1",
              { "border-r": index < dates.length - 1 }
            )}
            data-selected-date={date === selectedDate || undefined}
            key={date}
          >
            <span
              className={cn("text-caption", {
                "font-medium": date === today || date === selectedDate,
                "text-muted-fg": date !== today && date !== selectedDate,
              })}
            >
              {weekdayFormatter.format(new Date(`${date}T12:00:00Z`))}
            </span>
            <span
              className={cn("text-body-sm font-medium", {
                "text-primary": date === today,
              })}
            >
              {Number(date.slice(8))}
              {date === selectedDate ? (
                <span className="sr-only">, selected date</span>
              ) : null}
            </span>
          </div>
        ))}
        <div className="border-t border-r border-border/50 px-1 py-2 text-right text-micro whitespace-nowrap text-muted-fg">
          All day
        </div>
        {dates.map((date) => (
          <div
            className="relative min-h-8 space-y-1 border-t border-r border-border/50 px-0.5 py-1 last:border-r-0"
            data-selected-date={date === selectedDate || undefined}
            key={date}
            onDragOver={(event) => {
              if (dragRef.current) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              dropEvent(event, date, true);
            }}
          >
            {/* Native hit areas fill each all-day cell without adding a separate control row. */}
            <button
              aria-label={`Create all-day event on ${date}`}
              className="absolute inset-0 outline-none hover:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset"
              onClick={(event) => {
                if (event.detail === 0) {
                  onSlotCreate({ allDay: true, date, minute: 0 });
                } else if (event.detail === 1) {
                  onEmptyClick?.();
                }
              }}
              onDoubleClick={() => {
                onSlotCreate({ allDay: true, date, minute: 0 });
              }}
              type="button"
            />
            {(days.get(date) ?? [])
              .filter((item) => item.allDay)
              .map((item) => renderEvent(item, "compact"))}
          </div>
        ))}
      </div>
      <div
        className="grid h-336 w-full min-w-[var(--schedule-min-width)] grid-cols-[var(--schedule-columns)]"
        style={columnStyle}
      >
        <div aria-hidden className="relative border-r border-border/50">
          {hours.map((hour) => {
            const hourStyle: ScheduleStyle = {
              "--schedule-top": `${hour * hourHeight}px`,
            };
            return (
              <span
                className="absolute top-[var(--schedule-top)] right-2 -translate-y-1/2 text-micro text-muted-fg"
                key={hour}
                style={hourStyle}
              >
                {hour === 0 ? "" : formatMinute(hour * 60)}
              </span>
            );
          })}
        </div>
        {dates.map((date) => (
          <div
            className="relative border-r border-border/50 last:border-r-0"
            data-selected-date={date === selectedDate || undefined}
            key={date}
            onDragOver={(event) => {
              if (dragRef.current) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              dropEvent(event, date, false, true);
            }}
            onClick={(event) => {
              const button = event.target;
              if (
                !(button instanceof HTMLButtonElement) ||
                !Object.hasOwn(button.dataset, "slotMinute")
              ) {
                return;
              }
              const minute = Number(button.dataset.slotMinute);
              if (event.detail === 0) {
                onSlotCreate({ allDay: false, date, minute });
              } else if (event.detail === 1 && !suppressSlotClickRef.current) {
                onEmptyClick?.();
              }
            }}
            onDoubleClick={(event) => {
              const button = event.target;
              if (
                !(button instanceof HTMLButtonElement) ||
                !Object.hasOwn(button.dataset, "slotMinute")
              ) {
                return;
              }
              const minute = Number(button.dataset.slotMinute);
              if (suppressSlotClickRef.current) {
                return;
              }
              const clickedMinute =
                getSlotMinute({
                  boundary: "start",
                  button,
                  clientY: event.clientY,
                }) ?? minute;
              onSlotCreate({
                allDay: false,
                date,
                minute: clickedMinute,
              });
            }}
            onKeyDown={(event) => {
              const button = event.target;
              if (
                !(button instanceof HTMLButtonElement) ||
                !Object.hasOwn(button.dataset, "slotMinute")
              ) {
                return;
              }
              const minute = Number(button.dataset.slotMinute);
              if (event.key === "Escape" && selectionRef.current) {
                const { pointerId } = selectionRef.current;
                selectionRef.current = null;
                suppressSlotClickRef.current = true;
                setSelection(null);
                if (button.hasPointerCapture(pointerId)) {
                  button.releasePointerCapture(pointerId);
                }
                event.preventDefault();
                return;
              }
              moveSlotFocus(event, date, minute);
            }}
            onLostPointerCapture={() => {
              if (selectionRef.current) {
                selectionRef.current = null;
                suppressSlotClickRef.current = true;
                setSelection(null);
              }
            }}
            onPointerCancel={() => {
              selectionRef.current = null;
              suppressSlotClickRef.current = true;
              setSelection(null);
            }}
            onPointerDown={(event) => {
              const button = event.target;
              if (
                !(button instanceof HTMLButtonElement) ||
                !Object.hasOwn(button.dataset, "slotMinute")
              ) {
                return;
              }
              suppressSlotClickRef.current = false;
              // Touch keeps native vertical scrolling.
              if (
                event.button !== 0 ||
                !event.isPrimary ||
                event.pointerType === "touch" ||
                dragRef.current ||
                resize
              ) {
                return;
              }
              const anchorMinute = getSlotMinute({
                boundary: "start",
                button,
                clientY: event.clientY,
              });
              if (anchorMinute === null) {
                return;
              }
              event.preventDefault();
              button.focus({ preventScroll: true });
              button.setPointerCapture(event.pointerId);
              selectionRef.current = {
                anchorMinute,
                date,
                minute: anchorMinute,
                originY: event.clientY,
                phase: "pending",
                pointerId: event.pointerId,
              };
            }}
            onPointerMove={(event) => {
              const button = event.target;
              if (
                !(button instanceof HTMLButtonElement) ||
                !Object.hasOwn(button.dataset, "slotMinute")
              ) {
                return;
              }
              const activeSelection = selectionRef.current;
              if (
                !activeSelection ||
                activeSelection.pointerId !== event.pointerId ||
                (activeSelection.phase === "pending" &&
                  Math.abs(event.clientY - activeSelection.originY) < 4)
              ) {
                return;
              }
              const nextMinute = getSlotMinute({
                boundary: "end",
                button,
                clientY: event.clientY,
              });
              if (nextMinute === null) {
                return;
              }
              const nextSelection: SlotSelection = {
                ...activeSelection,
                minute: nextMinute,
                phase: "selecting",
              };
              selectionRef.current = nextSelection;
              setSelection(nextSelection);
            }}
            onPointerUp={(event) => {
              const button = event.target;
              if (
                !(button instanceof HTMLButtonElement) ||
                !Object.hasOwn(button.dataset, "slotMinute")
              ) {
                return;
              }
              const activeSelection = selectionRef.current;
              if (activeSelection?.pointerId !== event.pointerId) {
                return;
              }
              selectionRef.current = null;
              setSelection(null);
              if (button.hasPointerCapture(event.pointerId)) {
                button.releasePointerCapture(event.pointerId);
              }
              if (activeSelection.phase !== "selecting") {
                return;
              }
              suppressSlotClickRef.current = true;
              const startMinute = Math.min(
                activeSelection.anchorMinute,
                activeSelection.minute
              );
              onSlotCreate({
                allDay: false,
                date: activeSelection.date,
                endMinute: Math.max(
                  startMinute + 15,
                  activeSelection.anchorMinute,
                  activeSelection.minute
                ),
                minute: startMinute,
              });
            }}
            role="presentation"
          >
            {slotsByDate.get(date)}
            {positionTimedItems(days.get(date) ?? []).map(
              ({ column, columns: count, item }) => {
                const endMinute =
                  resize?.id === item.id && resize.date === date
                    ? resize.endMinute
                    : item.endMinute;
                const eventStyle: ScheduleStyle = {
                  "--schedule-height": `${Math.max(24, ((endMinute - item.startMinute) * hourHeight) / 60)}px`,
                  "--schedule-left": `${(column * 100) / count}%`,
                  "--schedule-top": `${(item.startMinute * hourHeight) / 60}px`,
                  "--schedule-width": `${100 / count}%`,
                };
                return (
                  <div
                    className="group/event-slot absolute top-[var(--schedule-top)] left-[var(--schedule-left)] z-10 h-[var(--schedule-height)] w-[var(--schedule-width)] min-w-0 p-0.5"
                    key={`${item.id}:${date}`}
                    style={eventStyle}
                  >
                    {renderEvent({ ...item, endMinute })}
                    {onEventResize && !item.preview ? (
                      <IconButtonTooltip label="Resize event, or use arrow keys">
                        <button
                          aria-label={`Resize ${item.title}. Use up or down arrows to adjust by 15 minutes.`}
                          className="absolute inset-x-1 bottom-0.5 z-20 h-2 cursor-ns-resize touch-none rounded-b-sm opacity-0 outline-none group-hover/event-slot:opacity-100 after:mx-auto after:mt-1 after:block after:h-0.5 after:w-6 after:rounded-full after:bg-fg/30 focus-visible:bg-primary/20 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key !== "ArrowUp" &&
                              event.key !== "ArrowDown"
                            ) {
                              return;
                            }
                            event.preventDefault();
                            onEventResize({
                              date,
                              endMinute: Math.max(
                                item.startMinute + 15,
                                Math.min(
                                  1440,
                                  item.endMinute +
                                    (event.key === "ArrowDown" ? 15 : -15)
                                )
                              ),
                              id: item.id,
                            });
                          }}
                          onPointerCancel={() => {
                            setResize(null);
                          }}
                          onPointerDown={(event) => {
                            if (event.button !== 0) {
                              return;
                            }
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(
                              event.pointerId
                            );
                            setResize({
                              date,
                              endMinute: item.endMinute,
                              id: item.id,
                              originMinute: item.endMinute,
                              originY: event.clientY,
                              startMinute: item.startMinute,
                            });
                          }}
                          onPointerMove={(event) => {
                            if (
                              !resize ||
                              resize.id !== item.id ||
                              resize.date !== date
                            ) {
                              return;
                            }
                            const target =
                              Math.round(
                                (resize.originMinute +
                                  ((event.clientY - resize.originY) * 60) /
                                    hourHeight) /
                                  15
                              ) * 15;
                            setResize({
                              ...resize,
                              endMinute: Math.max(
                                resize.startMinute + 15,
                                Math.min(1440, target)
                              ),
                            });
                          }}
                          onPointerUp={() => {
                            if (
                              !resize ||
                              resize.id !== item.id ||
                              resize.date !== date
                            ) {
                              return;
                            }
                            if (resize.endMinute !== resize.originMinute) {
                              onEventResize({
                                date,
                                endMinute: resize.endMinute,
                                id: item.id,
                              });
                            }
                            setResize(null);
                          }}
                          type="button"
                        />
                      </IconButtonTooltip>
                    ) : null}
                  </div>
                );
              }
            )}
            {selection?.date === date ? (
              <div
                aria-live="polite"
                className={cn(
                  "pointer-events-none absolute inset-x-0.5 top-[var(--schedule-top)] z-20 h-[var(--schedule-height)] overflow-hidden rounded-sm bg-[color-mix(in_srgb,var(--primary)_30%,var(--card))] px-2 py-1 text-caption font-medium text-fg ring-2 ring-primary",
                  {
                    "flex items-center px-1.5 py-0 text-micro leading-none":
                      selectionEnd - selectionStart < 30,
                  }
                )}
                style={selectionStyle}
              >
                {formatMinute(selectionStart)} to {formatMinute(selectionEnd)}
              </div>
            ) : null}
            {date === today && currentMinute !== undefined ? (
              <div
                aria-label={`Current time ${formatMinute(currentMinute)}`}
                className="pointer-events-none absolute inset-x-0 top-[var(--schedule-top)] z-20 border-t border-primary before:absolute before:-top-1 before:-left-1 before:size-2 before:rounded-full before:bg-primary"
                style={currentTimeStyle}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};
