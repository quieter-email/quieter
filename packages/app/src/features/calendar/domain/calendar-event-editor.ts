import type { CalendarEvent } from "@quieter/calendar";
import { createStore } from "@tanstack/react-store";

import { createCalendarEventForm } from "./calendar-event-form";
import type { CalendarEditor, CalendarEventForm } from "./calendar-event-form";

export type CalendarEventEditorState = {
  baseEvent: CalendarEvent | undefined;
  conflict: boolean;
  initialValues: CalendarEventForm;
  problem: string;
  reviewing: boolean;
  reviewed: CalendarEvent | null;
  sourceEvent: CalendarEvent | undefined;
  values: CalendarEventForm;
};

export const createCalendarEventEditorStore = (
  editor: CalendarEditor,
  timeZone: string
) => {
  const event = editor.kind === "edit" ? editor.event : undefined;
  const values = createCalendarEventForm(editor, timeZone);
  return createStore<CalendarEventEditorState>({
    baseEvent: event,
    conflict: false,
    initialValues: values,
    problem: "",
    reviewed: null,
    reviewing: false,
    sourceEvent: event,
    values,
  });
};

export const receiveCalendarEvent = ({
  editor,
  store,
  timeZone,
}: {
  editor: Extract<CalendarEditor, { kind: "edit" }>;
  store: ReturnType<typeof createCalendarEventEditorStore>;
  timeZone: string;
}) => {
  store.setState((current) => {
    if (current.sourceEvent === editor.event) {
      return current;
    }
    if (
      JSON.stringify(current.values) !== JSON.stringify(current.initialValues)
    ) {
      return { ...current, sourceEvent: editor.event };
    }
    const values = createCalendarEventForm(editor, timeZone);
    return {
      ...current,
      baseEvent: editor.event,
      conflict: false,
      initialValues: values,
      problem: "",
      reviewed: null,
      sourceEvent: editor.event,
      values,
    };
  });
};
