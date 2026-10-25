import "fake-indexeddb/auto";
import {
  applyCalendarMutationReceipt,
  bindCalendarCache,
  clearCalendarConnectionCache,
} from "@quieter/app/lib/calendar-cache-lifecycle";
import { mailCache } from "@quieter/app/lib/mail-cache";
import {
  persistQueryByKey,
  queryPersister,
  setQueryPersistenceUser,
} from "@quieter/app/lib/query-persister";
import { calendarEventSchema } from "@quieter/calendar";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const meeting = calendarEventSchema.parse({
  attendees: [],
  availability: "busy",
  calendarId: "primary",
  connectionId: "work",
  description: "Bring the roadmap",
  eventId: "planning",
  location: "Studio",
  meetingPending: false,
  permissions: { delete: true, edit: true, respond: false },
  recurrence: [],
  reminders: { kind: "default" },
  status: "confirmed",
  time: {
    end: "2026-10-31T11:00:00Z",
    kind: "timed",
    start: "2026-10-31T10:00:00Z",
    timeZone: "Europe/Berlin",
  },
  title: "Planning",
  version: "before",
  visibility: "private",
});

describe("calendar cache ownership and recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { length: 0 } });
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    setQueryPersistenceUser(undefined);
    vi.unstubAllGlobals();
  });

  test("restores a visited calendar after a client restart while offline", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const queryKey = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "primary",
      "events",
      { end: "2026-10-26", start: "2026-10-19" },
    ];
    const cached = {
      events: [
        {
          description: "Bring the roadmap",
          location: "Studio",
          title: "Planning",
        },
      ],
    };
    client.setQueryData(queryKey, cached);
    await persistQueryByKey(queryKey, client);
    client.clear();

    const restored = new QueryClient();
    setQueryPersistenceUser(userId, restored);
    onlineManager.setOnline(false);
    const result = await restored.query<typeof cached>({
      networkMode: "offlineFirst",
      persister: queryPersister.persisterFn,
      queryFn: () => {
        throw new Error("The network is unavailable.");
      },
      queryKey,
      staleTime: Infinity,
    });
    expect(result).toMatchObject(cached);
    restored.clear();
  });

  test("removes a disconnected account from disk and memory without removing another account", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const first = ["calendar", userId, "connection", "first", "calendars"];
    const second = ["calendar", userId, "connection", "second", "calendars"];
    client.setQueryData(first, { calendars: [{ name: "Work" }] });
    client.setQueryData(second, { calendars: [{ name: "Personal" }] });
    await persistQueryByKey(first, client);
    await persistQueryByKey(second, client);
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(second))
      ).resolves.toMatchObject({ calendars: [{ name: "Personal" }] });
    });
    await clearCalendarConnectionCache(client, userId, "first");
    expect(client.getQueryData(first)).toBeUndefined();
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(first))
    ).resolves.toBeUndefined();
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(second))
    ).resolves.toMatchObject({ calendars: [{ name: "Personal" }] });
    client.clear();
  });

  test("cannot restore private calendar content under a different login", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    const queryKey = ["calendar", userId, "connection", "account", "calendars"];
    setQueryPersistenceUser(userId, client);
    client.setQueryData(queryKey, {
      calendars: [{ name: "Private schedule" }],
    });
    await persistQueryByKey(queryKey, client);
    setQueryPersistenceUser(crypto.randomUUID(), new QueryClient());
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(queryKey))
    ).resolves.toBeUndefined();
    await expect(mailCache.entries()).resolves.toHaveLength(0);
    client.clear();
  });

  test("a request completing after disconnect cannot repopulate the persisted cache", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ["calendar", userId, "connection", "account", "calendars"];
    setQueryPersistenceUser(userId, client);
    const response = Promise.withResolvers<{ calendars: { name: string }[] }>();
    const started = Promise.withResolvers<boolean>();
    const request = client.query<{ calendars: { name: string }[] }>({
      persister: queryPersister.persisterFn,
      queryFn: async () => {
        started.resolve(true);
        return await response.promise;
      },
      queryKey,
    });
    const completion = request.catch(() => null);
    await started.promise;
    await clearCalendarConnectionCache(client, userId, "account");
    response.resolve({ calendars: [{ name: "Late response" }] });
    await completion;
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(queryKey))
    ).resolves.toBeUndefined();
    expect(client.getQueryData(queryKey)).toBeUndefined();
    client.clear();
  });

  test("a fresh connection list purges disconnected account data left only on disk", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    const queryKey = ["calendar", userId, "connection", "removed", "calendars"];
    setQueryPersistenceUser(userId, client);
    client.setQueryData(queryKey, { calendars: [{ name: "Old calendar" }] });
    await persistQueryByKey(queryKey, client);
    client.removeQueries({ queryKey });
    const unbind = bindCalendarCache(client, userId);
    client.setQueryData(["calendar", userId, "accounts"], { accounts: [] });
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(queryKey))
      ).resolves.toBeUndefined();
    });
    unbind();
    client.clear();
  });

  test("moving an event updates saved months and keeps other visits and details available offline", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const scope = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "primary",
    ];
    const october = [
      ...scope,
      "events",
      {
        end: "2026-11-01T00:00:00Z",
        start: "2026-10-01T00:00:00Z",
        timeZone: "UTC",
      },
    ];
    const november = [
      ...scope,
      "events",
      {
        end: "2026-12-01T00:00:00Z",
        start: "2026-11-01T00:00:00Z",
        timeZone: "UTC",
      },
    ];
    const september = [
      ...scope,
      "events",
      {
        end: "2026-10-01T00:00:00Z",
        start: "2026-09-01T00:00:00Z",
        timeZone: "UTC",
      },
    ];
    const detail = [...scope, "event", "other"];
    const other = { ...meeting, eventId: "other", title: "A separate meeting" };
    const visitedAt = Date.now() - 20_000;
    client.setQueryData(october, { events: [meeting] });
    client.setQueryData(november, { events: [] });
    client.setQueryData(
      september,
      { events: [other] },
      { updatedAt: visitedAt }
    );
    client.setQueryData(detail, other);
    for (const key of [october, november, september, detail]) {
      await persistQueryByKey(key, client);
    }
    await vi.waitFor(async () => {
      for (const key of [october, november, september, detail]) {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(key))
        ).resolves.toBeDefined();
      }
    });
    client.removeQueries({ queryKey: scope });
    const newer = { ...other, title: "A live update from another tab" };
    client.setQueryData(october, { events: [meeting, newer] });
    const moved = calendarEventSchema.parse({
      ...meeting,
      time: {
        end: "2026-11-02T11:00:00Z",
        kind: "timed",
        start: "2026-11-02T10:00:00Z",
        timeZone: "Europe/Berlin",
      },
      title: "Moved planning",
      version: "after",
    });
    await applyCalendarMutationReceipt(client, userId, {
      action: "updated",
      calendarId: "primary",
      connectionId: "work",
      event: moved,
      eventId: meeting.eventId,
      status: "success",
    });
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(november))
      ).resolves.toMatchObject({
        events: [expect.objectContaining({ title: "Moved planning" })],
      });
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(detail))
      ).resolves.toMatchObject({ title: "A separate meeting" });
    });
    client.clear();
    const restored = new QueryClient();
    setQueryPersistenceUser(userId, restored);
    onlineManager.setOnline(false);
    await queryPersister.restoreQueries(restored, { queryKey: scope });
    expect(restored.getQueryData(october)).toMatchObject({
      events: [{ title: "A live update from another tab" }],
    });
    expect(restored.getQueryData(november)).toMatchObject({
      events: [{ title: "Moved planning" }],
    });
    expect(restored.getQueryData(september)).toMatchObject({
      events: [{ title: "A separate meeting" }],
    });
    expect(restored.getQueryData(detail)).toMatchObject({
      description: "Bring the roadmap",
    });
    expect(restored.getQueryState(september)?.dataUpdatedAt).toBe(visitedAt);
    restored.clear();
  });

  test("creates all-day events in saved windows using the calendar zone and an exclusive end", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const scope = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "primary",
    ];
    const calendars = ["calendar", userId, "connection", "work", "calendars"];
    const overlap = [
      ...scope,
      "events",
      {
        end: "2026-11-02T08:00:00Z",
        start: "2026-11-02T00:00:00Z",
        timeZone: "UTC",
      },
    ];
    const after = [
      ...scope,
      "events",
      {
        end: "2026-11-03T08:00:00Z",
        start: "2026-11-02T08:00:00Z",
        timeZone: "UTC",
      },
    ];
    client.setQueryData(calendars, {
      calendars: [
        {
          access: "owner",
          calendarId: "primary",
          connectionId: "work",
          name: "Pacific schedule",
          primary: true,
          selected: true,
          supportsMeetings: true,
          timeZone: "America/Los_Angeles",
        },
      ],
    });
    client.setQueryData(overlap, { events: [] });
    client.setQueryData(after, { events: [] });
    for (const key of [calendars, overlap, after]) {
      await persistQueryByKey(key, client);
    }
    await vi.waitFor(async () => {
      for (const key of [calendars, overlap, after]) {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(key))
        ).resolves.toBeDefined();
      }
    });
    client.clear();
    const allDay = calendarEventSchema.parse({
      ...meeting,
      time: { endDate: "2026-11-02", kind: "all-day", startDate: "2026-11-01" },
      title: "A day in Pacific time",
    });
    await applyCalendarMutationReceipt(client, userId, {
      action: "created",
      calendarId: "primary",
      connectionId: "work",
      event: allDay,
      eventId: allDay.eventId,
      status: "success",
    });
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(overlap))
      ).resolves.toMatchObject({
        events: [{ title: "A day in Pacific time" }],
      });
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(after))
      ).resolves.toMatchObject({ events: [] });
    });
    client.clear();
  });

  test("deleting a series removes every saved occurrence and preserves unrelated offline content", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const scope = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "primary",
    ];
    const occurrence = { ...meeting, recurringEventId: "series" };
    const other = { ...meeting, eventId: "other", title: "Keep this meeting" };
    const month = [
      ...scope,
      "events",
      {
        end: "2026-11-01T00:00:00Z",
        start: "2026-10-01T00:00:00Z",
        timeZone: "UTC",
      },
    ];
    const instanceDetail = [...scope, "event", occurrence.eventId];
    const otherDetail = [...scope, "event", other.eventId];
    client.setQueryData(month, { events: [occurrence, other] });
    client.setQueryData(instanceDetail, occurrence);
    client.setQueryData(otherDetail, other);
    for (const key of [month, instanceDetail, otherDetail]) {
      await persistQueryByKey(key, client);
    }
    await vi.waitFor(async () => {
      for (const key of [month, instanceDetail, otherDetail]) {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(key))
        ).resolves.toBeDefined();
      }
    });
    client.removeQueries({ queryKey: scope });
    await applyCalendarMutationReceipt(client, userId, {
      action: "deleted",
      calendarId: "primary",
      connectionId: "work",
      eventId: "series",
      status: "success",
    });
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(month))
      ).resolves.toMatchObject({ events: [{ title: "Keep this meeting" }] });
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(otherDetail))
      ).resolves.toBeDefined();
    });
    client.clear();
    const restored = new QueryClient();
    setQueryPersistenceUser(userId, restored);
    onlineManager.setOnline(false);
    await queryPersister.restoreQueries(restored, { queryKey: scope });
    expect(restored.getQueryData(month)).toMatchObject({
      events: [{ eventId: "other" }],
    });
    expect(restored.getQueryData(instanceDetail)).toBeUndefined();
    expect(restored.getQueryData(otherDetail)).toMatchObject({
      title: "Keep this meeting",
    });
    restored.clear();
  });

  test("a change receipt without event content retains the saved event until refresh", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const scope = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "primary",
    ];
    const detail = [...scope, "event", meeting.eventId];
    client.setQueryData(detail, meeting);
    await persistQueryByKey(detail, client);
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(detail))
      ).resolves.toBeDefined();
    });
    client.clear();
    await applyCalendarMutationReceipt(client, userId, {
      action: "updated",
      calendarId: "primary",
      connectionId: "work",
      eventId: meeting.eventId,
      status: "success",
    });
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(detail))
      ).resolves.toMatchObject({ title: "Planning" });
    });
    expect(client.getQueryState(detail)?.isInvalidated).toBeTruthy();
    client.clear();
  });

  test("a recurring series change keeps unrelated details and never saves its master as an occurrence", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const scope = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "primary",
    ];
    const month = [
      ...scope,
      "events",
      {
        end: "2026-11-01T00:00:00Z",
        start: "2026-10-01T00:00:00Z",
        timeZone: "UTC",
      },
    ];
    const occurrence = { ...meeting, recurringEventId: "series" };
    const instanceDetail = [...scope, "event", occurrence.eventId];
    const otherDetail = [...scope, "event", "other"];
    client.setQueryData(month, { events: [occurrence] });
    client.setQueryData(instanceDetail, occurrence);
    client.setQueryData(otherDetail, {
      ...meeting,
      eventId: "other",
      title: "Independent appointment",
    });
    for (const key of [month, instanceDetail, otherDetail]) {
      await persistQueryByKey(key, client);
    }
    await vi.waitFor(async () => {
      for (const key of [month, instanceDetail, otherDetail]) {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(key))
        ).resolves.toBeDefined();
      }
    });
    client.clear();
    await applyCalendarMutationReceipt(client, userId, {
      action: "updated",
      calendarId: "primary",
      connectionId: "work",
      event: {
        ...meeting,
        eventId: "series",
        recurrence: ["RRULE:FREQ=DAILY"],
      },
      eventId: "series",
      status: "success",
    });
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(otherDetail))
      ).resolves.toMatchObject({ title: "Independent appointment" });
    });
    client.clear();
    const restored = new QueryClient();
    setQueryPersistenceUser(userId, restored);
    onlineManager.setOnline(false);
    await queryPersister.restoreQueries(restored, { queryKey: scope });
    expect(restored.getQueryData(month)).toBeUndefined();
    expect(restored.getQueryData(instanceDetail)).toBeUndefined();
    expect(restored.getQueryData([...scope, "event", "series"])).toMatchObject({
      recurrence: ["RRULE:FREQ=DAILY"],
    });
    expect(restored.getQueryData(otherDetail)).toMatchObject({
      title: "Independent appointment",
    });
    restored.clear();
  });

  test("parallel changes in separate calendars retain every saved visit", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient();
    setQueryPersistenceUser(userId, client);
    const saved = [
      {
        calendarId: "first",
        end: "2026-11-01T00:00:00Z",
        start: "2026-10-01T00:00:00Z",
      },
      {
        calendarId: "second",
        end: "2026-11-01T00:00:00Z",
        start: "2026-10-01T00:00:00Z",
      },
      {
        calendarId: "second",
        end: "2026-12-01T00:00:00Z",
        start: "2026-11-01T00:00:00Z",
      },
      {
        calendarId: "second",
        end: "2027-01-01T00:00:00Z",
        start: "2026-12-01T00:00:00Z",
      },
    ].map(({ calendarId, end, start }) => ({
      calendarId,
      key: [
        "calendar",
        userId,
        "connection",
        "work",
        "calendar",
        calendarId,
        "events",
        { end, start, timeZone: "UTC" },
      ],
    }));
    for (const { key } of saved) {
      client.setQueryData(key, { events: [] });
      await persistQueryByKey(key, client);
    }
    await vi.waitFor(async () => {
      for (const { key } of saved) {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(key))
        ).resolves.toBeDefined();
      }
    });
    client.clear();
    await Promise.all(
      ["first", "second"].map(async (calendarId) => {
        await applyCalendarMutationReceipt(client, userId, {
          action: "created",
          calendarId,
          connectionId: "work",
          event: { ...meeting, calendarId },
          eventId: meeting.eventId,
          status: "success",
        });
      })
    );
    await vi.waitFor(async () => {
      for (const { key } of saved) {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(key))
        ).resolves.toBeDefined();
      }
    });
    client.clear();
  });

  test.each([403, 404])(
    "losing access to one calendar preserves the rest of the connected account (%i)",
    async (status) => {
      const userId = crypto.randomUUID();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      setQueryPersistenceUser(userId, client);
      const removed = [
        "calendar",
        userId,
        "connection",
        "work",
        "calendar",
        "shared",
        "event",
        "one",
      ];
      const kept = [
        "calendar",
        userId,
        "connection",
        "work",
        "calendar",
        "personal",
        "event",
        "two",
      ];
      client.setQueryData(removed, { title: "Shared planning" });
      client.setQueryData(kept, { title: "Personal planning" });
      await persistQueryByKey(removed, client);
      await persistQueryByKey(kept, client);
      const unbind = bindCalendarCache(client, userId);
      await expect(
        client.query({
          queryFn: () => {
            throw Object.assign(new Error("Access changed"), { status });
          },
          queryKey: removed,
          staleTime: 0,
        })
      ).rejects.toThrow("Access changed");
      await vi.waitFor(async () => {
        await expect(
          queryPersister.retrieveQuery(JSON.stringify(removed))
        ).resolves.toBeUndefined();
      });
      expect(client.getQueryData(removed)).toBeUndefined();
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(kept))
      ).resolves.toMatchObject({ title: "Personal planning" });
      unbind();
      client.clear();
    }
  );

  test("a temporary quota failure retains saved events", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setQueryPersistenceUser(userId, client);
    const queryKey = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "personal",
      "event",
      "one",
    ];
    client.setQueryData(queryKey, { title: "Saved planning" });
    await persistQueryByKey(queryKey, client);
    const unbind = bindCalendarCache(client, userId);
    await expect(
      client.query({
        queryFn: () => {
          throw Object.assign(new Error("Temporarily busy"), { status: 429 });
        },
        queryKey,
        staleTime: 0,
      })
    ).rejects.toThrow("Temporarily busy");
    expect(client.getQueryData(queryKey)).toMatchObject({
      title: "Saved planning",
    });
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(queryKey))
    ).resolves.toMatchObject({ title: "Saved planning" });
    unbind();
    client.clear();
  });

  test("connection authorization loss removes all its calendars but preserves another account", async () => {
    const userId = crypto.randomUUID();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setQueryPersistenceUser(userId, client);
    const first = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "one",
      "event",
      "first",
    ];
    const second = [
      "calendar",
      userId,
      "connection",
      "work",
      "calendar",
      "two",
      "event",
      "second",
    ];
    const kept = ["calendar", userId, "connection", "personal", "calendars"];
    for (const key of [first, second, kept]) {
      client.setQueryData(key, { title: "Saved planning" });
      await persistQueryByKey(key, client);
    }
    const unbind = bindCalendarCache(client, userId);
    await expect(
      client.query({
        queryFn: () => {
          throw Object.assign(new Error("Reconnect"), { status: 401 });
        },
        queryKey: first,
        staleTime: 0,
      })
    ).rejects.toThrow("Reconnect");
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(second))
      ).resolves.toBeUndefined();
    });
    expect(client.getQueryData(first)).toBeUndefined();
    expect(client.getQueryData(second)).toBeUndefined();
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(kept))
    ).resolves.toMatchObject({ title: "Saved planning" });
    unbind();
    client.clear();
  });
});
