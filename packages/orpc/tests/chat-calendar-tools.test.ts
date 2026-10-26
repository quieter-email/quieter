import { ORPCError } from "@orpc/server";
import {
  foregroundSnapshotSchema,
  resolveCalendarWriteReview,
} from "@quieter/ai/chat-tools";
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
  assertCalendarToolApproval,
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

describe("calendar tool approvals", () => {
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
    "binds $label writes to their approved exchange, tool call, target and changes",
    ({ account: sourceAccount }) => {
      const approved = {
        foreground,
        input: updateInput,
        toolCallId: "change-1",
        toolName: "update_calendar_event" as const,
        transcript: approvedTranscript({
          input: updateInput,
          sourceAccount,
          toolName: "update_calendar_event",
        }),
      };
      expect(() => {
        assertCalendarToolApproval(approved);
      }).not.toThrow();
      for (const patch of [
        { input: { ...updateInput, connectionId: "another-account" } },
        { input: { ...updateInput, calendarId: "another-calendar" } },
        { input: { ...updateInput, eventId: "series-1" } },
        { input: { ...updateInput, version: "another-version" } },
        { input: { ...updateInput, changes: { title: "Unreviewed change" } } },
        { toolCallId: "another-call" },
        { foreground: { ...foreground, exchangeId: crypto.randomUUID() } },
      ]) {
        expect(() => {
          assertCalendarToolApproval({ ...approved, ...patch });
        }).toThrow(/approve|differs/iu);
      }
    }
  );

  test.each(accountSnapshots)(
    "requires $label read evidence at the approved version before an event write",
    ({ account: sourceAccount }) => {
      const transcript = approvedTranscript({
        input: updateInput,
        sourceAccount,
        sourceEvent: { ...event, version: "old-version" },
        toolName: "update_calendar_event",
      });
      expect(() => {
        assertCalendarToolApproval({
          foreground,
          input: updateInput,
          toolCallId: "change-1",
          toolName: "update_calendar_event",
          transcript,
        });
      }).toThrow(/read/iu);
    }
  );

  test("shows the fetched occurrence or series as the actual recurrence target", () => {
    const occurrence = resolveCalendarWriteReview({
      input: updateInput,
      toolName: "update_calendar_event",
      transcript: approvedTranscript({
        input: updateInput,
        toolName: "update_calendar_event",
      }),
    });
    expect(occurrence).toMatchObject({
      account: { email: account.email },
      calendar: { name: calendar.name },
      scope: "occurrence",
      title: "Reviewed meeting",
    });
    const master = {
      ...event,
      eventId: "series-1",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      recurringEventId: undefined,
      version: "master-version",
    };
    const input = {
      ...updateInput,
      eventId: master.eventId,
      version: master.version,
    };
    expect(
      resolveCalendarWriteReview({
        input,
        toolName: "update_calendar_event",
        transcript: approvedTranscript({
          input,
          sourceEvent: master,
          toolName: "update_calendar_event",
        }),
      })
    ).toMatchObject({ scope: "series" });
  });

  test("never calls the provider without a persisted approval or after cancellation", async () => {
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
