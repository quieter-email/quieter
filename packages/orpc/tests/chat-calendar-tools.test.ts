import { ORPCError } from "@orpc/server";
import { foregroundSnapshotSchema } from "@quieter/ai/chat-tools";
import type {
  CalendarWriteReview,
  CalendarWriteToolName,
} from "@quieter/ai/chat-tools";
import {
  calendarEventDraftSchema,
  calendarEventSchema,
} from "@quieter/calendar";
import type { CalendarAccount, CalendarSummary } from "@quieter/calendar";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type * as CalendarService from "../src/calendar/service";
import {
  assertCalendarToolExecution,
  createCalendarToolsContext,
  deriveCalendarToolOperationId,
} from "../src/chat/calendar-tools";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn<typeof CalendarService.listCalendarAccountsForUser>(),
  calendars: vi.fn<typeof CalendarService.listCalendarsForUser>(),
  create: vi.fn<typeof CalendarService.createCalendarEventForUser>(),
  delete: vi.fn<typeof CalendarService.deleteCalendarEventForUser>(),
  event: vi.fn<typeof CalendarService.getCalendarEventForUser>(),
  events: vi.fn<typeof CalendarService.listCalendarEventsForUser>(),
  respond: vi.fn<typeof CalendarService.respondToCalendarEventForUser>(),
  update: vi.fn<typeof CalendarService.updateCalendarEventForUser>(),
}));
vi.mock(import("../src/calendar/service"), () => ({
  createCalendarEventForUser: mocks.create,
  deleteCalendarEventForUser: mocks.delete,
  getCalendarEventForUser: mocks.event,
  listCalendarAccountsForUser: mocks.accounts,
  listCalendarEventsForUser: mocks.events,
  listCalendarsForUser: mocks.calendars,
  respondToCalendarEventForUser: mocks.respond,
  updateCalendarEventForUser: mocks.update,
}));

const foreground = foregroundSnapshotSchema.parse({
  capabilities: ["navigate", "modify_calendar"],
  exchangeId: "d6c6b64a-1d5f-4406-9b1b-53a73ff6f41b",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  tabId: "tab-1",
  workspace: "calendar",
});
const account = {
  email: "owner@example.test",
  id: "connection-1",
  name: "Personal",
  status: "connected",
} satisfies Pick<CalendarAccount, "email" | "id" | "name" | "status">;
const accountSnapshots = [
  { account, label: "a persisted calendar connector" },
  {
    account: { ...account, mailboxId: "mailbox-1" } satisfies CalendarAccount,
    label: "a Gmail mailbox",
  },
];
const calendar = {
  access: "owner",
  calendarId: "calendar-1",
  connectionId: account.id,
  name: "Personal calendar",
  primary: true,
  selected: true,
  supportsMeetings: true,
  timeZone: "Europe/Berlin",
} satisfies CalendarSummary;
const draft = calendarEventDraftSchema.parse({
  time: {
    end: "2026-10-23T12:00:00+02:00",
    kind: "timed",
    start: "2026-10-23T11:00:00+02:00",
    timeZone: "Europe/Berlin",
  },
  title: "Project meeting",
});
const event = calendarEventSchema.parse({
  attendees: draft.attendees,
  availability: draft.availability,
  calendarId: calendar.calendarId,
  connectionId: account.id,
  description: draft.description,
  eventId: "occurrence-1",
  location: draft.location,
  meetingPending: false,
  permissions: { delete: true, edit: true, respond: true },
  recurrence: draft.recurrence,
  recurringEventId: "series-1",
  reminders: draft.reminders,
  status: "confirmed",
  time: draft.time,
  title: draft.title,
  version: "current-version",
  visibility: draft.visibility,
});
const createInput = {
  calendarId: calendar.calendarId,
  connectionId: account.id,
  event: draft,
};
const updateInput = {
  calendarId: calendar.calendarId,
  changes: { title: "Reviewed meeting" },
  connectionId: account.id,
  eventId: event.eventId,
  version: event.version,
};

const deleteInput = {
  calendarId: calendar.calendarId,
  connectionId: account.id,
  eventId: event.eventId,
  version: event.version,
};

const approvedTranscript = ({
  input,
  sourceAccount = account,
  sourceEvent = event,
  toolName,
}: {
  input: unknown;
  sourceAccount?: CalendarWriteReview["account"];
  sourceEvent?: typeof event;
  toolName: CalendarWriteToolName;
}): UIMessage[] => [
  {
    id: foreground.exchangeId,
    parts: [
      {
        input: { connectionId: account.id },
        output: {
          accounts: [sourceAccount],
          calendars: [calendar],
          fetchedAt: new Date().toISOString(),
          status: "success",
        },
        state: "output-available",
        toolCallId: "calendars-1",
        type: "tool-list_calendars",
      },
      {
        input: {
          calendarId: calendar.calendarId,
          connectionId: account.id,
          eventId: sourceEvent.eventId,
        },
        output: {
          event: sourceEvent,
          fetchedAt: new Date().toISOString(),
          status: "success",
        },
        state: "output-available",
        toolCallId: "event-1",
        type: "tool-get_calendar_event",
      },
      {
        approval: { approved: true, id: "approval-1" },
        input,
        state: "approval-responded",
        toolCallId: "change-1",
        type: `tool-${toolName}`,
      },
    ],
    role: "assistant",
  },
];

describe("calendar tool execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
      action: "created",
      calendarId: calendar.calendarId,
      connectionId: account.id,
      event,
      eventId: event.eventId,
      status: "success",
    });
  });

  test.each(accountSnapshots)(
    "binds $label deletions to their approved exchange, tool call, target and changes",
    ({ account: sourceAccount }) => {
      const approved = {
        foreground,
        input: deleteInput,
        toolCallId: "change-1",
        toolName: "delete_calendar_event" as const,
        transcript: approvedTranscript({
          input: deleteInput,
          sourceAccount,
          toolName: "delete_calendar_event",
        }),
      };
      expect(() => {
        assertCalendarToolExecution(approved);
      }).not.toThrow();
      for (const patch of [
        { input: { ...deleteInput, connectionId: "another-account" } },
        { input: { ...deleteInput, calendarId: "another-calendar" } },
        { input: { ...deleteInput, eventId: "series-1" } },
        { input: { ...deleteInput, version: "another-version" } },
        { toolCallId: "another-call" },
        { foreground: { ...foreground, exchangeId: crypto.randomUUID() } },
      ]) {
        expect(() => {
          assertCalendarToolExecution({ ...approved, ...patch });
        }).toThrow(/approve|differs/iu);
      }
    }
  );

  test.each(accountSnapshots)(
    "requires $label read evidence at the current version before an event write",
    ({ account: sourceAccount }) => {
      const transcript = approvedTranscript({
        input: updateInput,
        sourceAccount,
        sourceEvent: { ...event, version: "old-version" },
        toolName: "update_calendar_event",
      });
      expect(() => {
        assertCalendarToolExecution({
          foreground,
          input: updateInput,
          toolCallId: "change-1",
          toolName: "update_calendar_event",
          transcript,
        });
      }).toThrow(/read/iu);
    }
  );

  test("preserves exact persisted deletion approval alongside fresh reads", async () => {
    mocks.accounts.mockResolvedValue({
      accounts: [{ ...account, mailboxId: "mailbox-1" }],
      googleConfigured: true,
      isConfigured: true,
      microsoftConfigured: false,
    });
    mocks.calendars.mockResolvedValue({ calendars: [calendar] });
    mocks.event.mockResolvedValue(event);
    const transcript = approvedTranscript({
      input: deleteInput,
      toolName: "delete_calendar_event",
    }).map((message) => ({ ...message, parts: message.parts.slice(2) }));
    const context = createCalendarToolsContext({
      foreground,
      transcript,
      userId: "signed-in-user",
    });
    await context.listCalendars({ connectionId: account.id });
    await context.getEvent(deleteInput);
    await context.deleteEvent(deleteInput, { toolCallId: "another-call" });
    expect(mocks.delete).not.toHaveBeenCalled();
    await context.deleteEvent(deleteInput, { toolCallId: "change-1" });
    expect(mocks.delete).toHaveBeenCalledWith(
      expect.objectContaining({ ...deleteInput, userId: "signed-in-user" })
    );
    const separateContext = createCalendarToolsContext({
      foreground,
      transcript: [],
      userId: "another-user",
    });
    await expect(
      separateContext.createEvent(createInput, { toolCallId: "create-other" })
    ).resolves.toMatchObject({ status: "error" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("requires current event discovery even for approved deletion", () => {
    expect(() => {
      assertCalendarToolExecution({
        foreground,
        input: deleteInput,
        toolCallId: "change-1",
        toolName: "delete_calendar_event",
        transcript: approvedTranscript({
          input: deleteInput,
          sourceEvent: { ...event, version: "old-version" },
          toolName: "delete_calendar_event",
        }),
      });
    }).toThrow(/read/iu);
  });

  test("rejects denied deletion approval before reaching the provider", async () => {
    const transcript = approvedTranscript({
      input: deleteInput,
      toolName: "delete_calendar_event",
    });
    transcript[0]?.parts.splice(2, 1, {
      approval: { approved: false, id: "approval-1" },
      input: deleteInput,
      state: "approval-responded",
      toolCallId: "change-1",
      type: "tool-delete_calendar_event",
    });
    const context = createCalendarToolsContext({
      foreground,
      transcript,
      userId: "signed-in-user",
    });
    await expect(
      context.deleteEvent(deleteInput, { toolCallId: "change-1" })
    ).resolves.toMatchObject({ status: "error" });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  test.each([
    { connectionId: "another-account" },
    { calendarId: "another-calendar" },
    { eventId: "another-event" },
    { version: "another-version" },
  ])("blocks routine writes outside discovered context %j", async (patch) => {
    const transcript = approvedTranscript({
      input: updateInput,
      toolName: "update_calendar_event",
    }).map((message) => ({ ...message, parts: message.parts.slice(0, 2) }));
    const context = createCalendarToolsContext({
      foreground,
      transcript,
      userId: "signed-in-user",
    });
    await expect(
      context.updateEvent(
        { ...updateInput, ...patch },
        { toolCallId: "update-1" }
      )
    ).resolves.toMatchObject({ status: "error" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("never calls the provider without discovery or after cancellation", async () => {
    const context = createCalendarToolsContext({
      foreground,
      transcript: [],
      userId: "signed-in-user",
    });
    await expect(
      context.createEvent(createInput, { toolCallId: "change-1" })
    ).resolves.toMatchObject({ status: "error" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      context.createEvent(createInput, {
        signal: controller.signal,
        toolCallId: "change-1",
      })
    ).rejects.toThrow(/abort/iu);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("uses authenticated user ownership and a stable server-derived create identity", async () => {
    const context = createCalendarToolsContext({
      foreground,
      transcript: approvedTranscript({
        input: createInput,
        toolName: "create_calendar_event",
      }),
      userId: "signed-in-user",
    });
    await expect(
      context.createEvent(createInput, { toolCallId: "change-1" })
    ).resolves.toMatchObject({ action: "created", status: "success" });
    const operationId = await deriveCalendarToolOperationId({
      exchangeId: foreground.exchangeId,
      toolCallId: "change-1",
      userId: "signed-in-user",
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: calendar.calendarId,
        connectionId: account.id,
        operationId,
        userId: "signed-in-user",
      })
    );
    await expect(
      deriveCalendarToolOperationId({
        exchangeId: foreground.exchangeId,
        toolCallId: "change-1",
        userId: "other-user",
      })
    ).resolves.not.toBe(operationId);
  });

  test.each(accountSnapshots)(
    "reauthorizes $label writes even when historical metadata claims access",
    async ({ account: sourceAccount }) => {
      mocks.create.mockRejectedValueOnce(
        new ORPCError("FORBIDDEN", {
          message: "Calendar access was revoked.",
        })
      );
      const context = createCalendarToolsContext({
        foreground,
        transcript: approvedTranscript({
          input: createInput,
          sourceAccount,
          toolName: "create_calendar_event",
        }),
        userId: "signed-in-user",
      });
      const result = await context.createEvent(createInput, {
        toolCallId: "change-1",
      });
      expect(result.status).toBe("error");
      expect(result).toHaveProperty(
        "error",
        expect.stringMatching(/revoked/iu)
      );
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: account.id,
          userId: "signed-in-user",
        })
      );
    }
  );
});
