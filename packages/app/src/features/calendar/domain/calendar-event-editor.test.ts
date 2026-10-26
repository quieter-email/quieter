import { describe, expect, it } from "vite-plus/test";

import {
  createCalendarEventEditorStore,
  receiveCalendarEvent,
} from "./calendar-event-editor";
import {
  createCalendarEventForm,
  parseCalendarEventForm,
} from "./calendar-event-form";
import { createCalendarPreviewEvents } from "./calendar-preview";

const timeZone = "Europe/Berlin";
const [event] = createCalendarPreviewEvents({ date: "2026-10-26", timeZone });
const editor = { event, kind: "edit", scope: "occurrence" } as const;

describe("calendar event editor session", () => {
  it("refreshes a pristine draft and uses the fresh version for the next edit", () => {
    const store = createCalendarEventEditorStore(editor, timeZone);
    const refreshed = {
      ...editor,
      event: {
        ...event,
        meetingUrl: "https://meet.google.com/fresh-meet-link",
        title: "Updated elsewhere",
        version: "refreshed-version",
      },
    };
    receiveCalendarEvent({ editor: refreshed, store, timeZone });
    const state = store.get();
    expect(state.values.title).toMatch(/updated elsewhere/iu);
    expect(state.baseEvent).toMatchObject({
      meetingUrl: refreshed.event.meetingUrl,
      version: refreshed.event.version,
    });
    expect(
      parseCalendarEventForm(state.values, state.baseEvent).addMeeting
    ).toBeTruthy();
  });

  it("preserves a dirty draft and its version when the event refreshes", () => {
    const store = createCalendarEventEditorStore(editor, timeZone);
    store.setState((current) => ({
      ...current,
      values: { ...current.values, title: "My unsaved title" },
    }));
    receiveCalendarEvent({
      editor: {
        ...editor,
        event: { ...event, title: "Someone else's title", version: "new" },
      },
      store,
      timeZone,
    });
    const state = store.get();
    expect(parseCalendarEventForm(state.values, state.baseEvent).title).toMatch(
      /my unsaved title/iu
    );
    expect(state.baseEvent?.version).toBe(event.version);
    expect(state.sourceEvent?.title).toMatch(/someone else's title/iu);
  });

  it("does not roll back a successful save while the source query still has the prior event", () => {
    const store = createCalendarEventEditorStore(editor, timeZone);
    const saved = { ...event, title: "Saved title", version: "saved-version" };
    const values = createCalendarEventForm(
      { ...editor, event: saved },
      timeZone
    );
    store.setState((current) => ({
      ...current,
      baseEvent: saved,
      initialValues: values,
      values,
    }));
    receiveCalendarEvent({ editor, store, timeZone });
    expect(store.get().baseEvent?.version).toBe(saved.version);
    expect(store.get().values.title).toMatch(/saved title/iu);
  });
});
