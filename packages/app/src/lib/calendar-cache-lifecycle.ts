import { mailCache } from "@quieter/app/lib/mail-cache";
import {
  persistQueryByKey,
  removeCalendarScopePersistence,
  restoreMissingCalendarScopeQueries,
} from "@quieter/app/lib/query-persister";
import {
  calendarAccountSchema,
  calendarEventSchema,
  calendarEventsInputSchema,
  calendarSummarySchema,
} from "@quieter/calendar";
import type { CalendarMutationResult } from "@quieter/calendar";
import { getCalendarRange } from "@quieter/calendar/time";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

const accountsSchema = z.object({ accounts: z.array(calendarAccountSchema) });
const calendarsSchema = z.object({ calendars: z.array(calendarSummarySchema) });
const eventsSchema = z.object({ events: z.array(calendarEventSchema) });
const rangeSchema = z.object({
  end: calendarEventsInputSchema.shape.end,
  query: calendarEventsInputSchema.shape.query,
  start: calendarEventsInputSchema.shape.start,
  timeZone: calendarEventsInputSchema.shape.timeZone,
});
const calendarCacheChanges = new WeakMap<QueryClient, Promise<void>>();

const runCalendarCacheChange = async (
  client: QueryClient,
  change: () => Promise<void>
) => {
  const previous = calendarCacheChanges.get(client);
  const current = (async () => {
    if (previous) {
      await Promise.allSettled([previous]);
    }
    await change();
  })();
  calendarCacheChanges.set(client, current);
  try {
    await current;
  } finally {
    if (calendarCacheChanges.get(client) === current) {
      calendarCacheChanges.delete(client);
    }
  }
};

export const applyCalendarMutationReceipt = async (
  client: QueryClient,
  userId: string,
  receipt: CalendarMutationResult
) => {
  const scope = [
    "calendar",
    userId,
    "connection",
    receipt.connectionId,
    "calendar",
    receipt.calendarId,
  ];
  await runCalendarCacheChange(client, async () => {
    await client.cancelQueries({ queryKey: scope });
    await restoreMissingCalendarScopeQueries(
      client,
      userId,
      receipt.connectionId,
      receipt.calendarId
    );
    await removeCalendarScopePersistence(
      userId,
      receipt.connectionId,
      receipt.calendarId
    );
    const nextEvent =
      receipt.event?.connectionId === receipt.connectionId &&
      receipt.event.calendarId === receipt.calendarId &&
      receipt.event.eventId === receipt.eventId
        ? receipt.event
        : undefined;
    const calendars = calendarsSchema.safeParse(
      client.getQueryData([...scope.slice(0, 4), "calendars"])
    );
    const calendarTimeZone = calendars.success
      ? calendars.data.calendars.find(
          (calendar) =>
            calendar.connectionId === receipt.connectionId &&
            calendar.calendarId === receipt.calendarId
        )?.timeZone
      : undefined;
    const expandsSeries =
      nextEvent !== undefined &&
      nextEvent.recurrence.length > 0 &&
      !nextEvent.recurringEventId;
    let bounds: { end: number; start: number } | undefined;
    if (nextEvent?.time.kind === "timed") {
      bounds = {
        end: Date.parse(nextEvent.time.end),
        start: Date.parse(nextEvent.time.start),
      };
    } else if (nextEvent?.time.kind === "all-day" && calendarTimeZone) {
      bounds = {
        end: Date.parse(
          getCalendarRange({
            date: nextEvent.time.endDate,
            timeZone: calendarTimeZone,
            view: "day",
          }).start
        ),
        start: Date.parse(
          getCalendarRange({
            date: nextEvent.time.startDate,
            timeZone: calendarTimeZone,
            view: "day",
          }).start
        ),
      };
    }
    const discardPersistence = new Set<string>();
    for (const query of client
      .getQueryCache()
      .findAll({ queryKey: [...scope, "events"] })) {
      const parsed = eventsSchema.safeParse(query.state.data);
      if (!parsed.success) {
        discardPersistence.add(query.queryHash);
        continue;
      }
      if (receipt.action !== "deleted" && !nextEvent) {
        continue;
      }
      const range = rangeSchema.safeParse(query.queryKey[7]);
      const events = parsed.data.events.filter(
        (event) =>
          event.connectionId === receipt.connectionId &&
          event.calendarId === receipt.calendarId &&
          event.eventId !== receipt.eventId &&
          event.recurringEventId !== receipt.eventId
      );
      if (
        receipt.action !== "deleted" &&
        (!range.success || range.data.query || expandsSeries || !bounds)
      ) {
        discardPersistence.add(query.queryHash);
        if (query.getObserversCount() === 0) {
          client.removeQueries({ exact: true, queryKey: query.queryKey });
        } else {
          client.setQueryData(query.queryKey, { events }, { updatedAt: 0 });
        }
        continue;
      }
      if (
        receipt.action !== "deleted" &&
        nextEvent &&
        nextEvent.status !== "cancelled" &&
        bounds &&
        range.success &&
        bounds.start < Date.parse(range.data.end) &&
        bounds.end > Date.parse(range.data.start)
      ) {
        events.push(nextEvent);
      }
      client.setQueryData(
        query.queryKey,
        { events },
        { updatedAt: query.state.dataUpdatedAt }
      );
    }
    const detailKey = [...scope, "event", receipt.eventId];
    for (const query of client
      .getQueryCache()
      .findAll({ queryKey: [...scope, "event"] })) {
      const detail = calendarEventSchema.safeParse(query.state.data);
      if (
        (receipt.action === "deleted" &&
          query.queryKey[7] === receipt.eventId) ||
        (detail.success &&
          detail.data.connectionId === receipt.connectionId &&
          detail.data.calendarId === receipt.calendarId &&
          detail.data.recurringEventId === receipt.eventId &&
          (receipt.action === "deleted" || nextEvent))
      ) {
        client.removeQueries({ exact: true, queryKey: query.queryKey });
      }
    }
    if (receipt.action !== "deleted" && nextEvent) {
      client.setQueryData(detailKey, nextEvent);
    }
    await client.invalidateQueries({ queryKey: scope, refetchType: "none" });
    for (const query of client.getQueryCache().findAll({ queryKey: scope })) {
      if (!discardPersistence.has(query.queryHash)) {
        await persistQueryByKey(query.queryKey, client);
      }
    }
  });
  await client.invalidateQueries({ queryKey: scope }, { throwOnError: false });
};

export const clearCalendarConnectionCache = async (
  client: QueryClient,
  userId: string,
  connectionId: string
) => {
  const queryKey = ["calendar", userId, "connection", connectionId];
  await runCalendarCacheChange(client, async () => {
    await client.cancelQueries({ queryKey });
    client.removeQueries({ queryKey });
    await removeCalendarScopePersistence(userId, connectionId);
  });
};

export const bindCalendarCache = (client: QueryClient, userId?: string) => {
  let disposed = false;
  let pinned = new Set<string>();
  let pruning = Promise.resolve();

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    const rawKey: unknown = event.query.queryKey;
    if (!Array.isArray(rawKey)) {
      return;
    }
    const key: readonly unknown[] = rawKey;
    if (!userId || key[0] !== "calendar" || key[1] !== userId) {
      return;
    }
    const next = new Set(
      client
        .getQueryCache()
        .findAll({
          queryKey: ["calendar", userId],
          type: "active",
        })
        .map((query) => `quieter-cache-${query.queryHash}`)
    );
    for (const entry of pinned) {
      if (!next.has(entry)) {
        mailCache.protect(entry, false);
      }
    }
    for (const entry of next) {
      if (!pinned.has(entry)) {
        mailCache.protect(entry, true);
      }
    }
    pinned = next;
    if (event.type !== "updated") {
      return;
    }

    if (event.action.type === "success" && key[2] === "accounts") {
      const snapshot: unknown = event.query.state.data;
      const previous = pruning;
      pruning = (async () => {
        await previous;
        try {
          if (disposed || client.getQueryData(key) !== snapshot) {
            return;
          }
          const parsed = accountsSchema.safeParse(snapshot);
          if (!parsed.success) {
            return;
          }
          const connected = new Set(
            parsed.data.accounts
              .filter((account) => account.status === "connected")
              .map((account) => account.id)
          );
          const obsolete = new Set<string>();
          for (const query of client
            .getQueryCache()
            .findAll({ queryKey: ["calendar", userId, "connection"] })) {
            const { 3: connectionId }: readonly unknown[] = query.queryKey;
            if (
              typeof connectionId === "string" &&
              !connected.has(connectionId)
            ) {
              obsolete.add(connectionId);
            }
          }
          for (const [storageKey] of await mailCache.entries()) {
            if (!storageKey.startsWith("quieter-cache-")) {
              continue;
            }
            const stored: unknown = JSON.parse(
              storageKey.slice("quieter-cache-".length)
            );
            if (!Array.isArray(stored)) {
              continue;
            }
            const storedKey: readonly unknown[] = stored;
            const [root, owner, scope, connectionId] = storedKey;
            if (
              root === "calendar" &&
              owner === userId &&
              scope === "connection" &&
              typeof connectionId === "string" &&
              !connected.has(connectionId)
            ) {
              obsolete.add(connectionId);
            }
          }
          for (const connectionId of obsolete) {
            if (disposed || client.getQueryData(key) !== snapshot) {
              return;
            }
            await clearCalendarConnectionCache(client, userId, connectionId);
          }
          await persistQueryByKey(["calendar", userId, "accounts"], client);
        } catch {
          /* Persistence is optional. */
        }
      })();
      return;
    }

    const { 2: scope, 3: connectionId } = key;
    if (
      event.action.type !== "error" ||
      scope !== "connection" ||
      typeof connectionId !== "string"
    ) {
      return;
    }
    const error: unknown = event.action.error;
    const status: unknown =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "status")
        : undefined;
    const previous = pruning;
    if (status === 401 || status === 403 || status === 404) {
      pruning = (async () => {
        await previous;
        if (disposed) {
          return;
        }
        try {
          if (
            status !== 401 &&
            key[4] === "calendar" &&
            typeof key[5] === "string"
          ) {
            const { 5: calendarId } = key;
            const queryKey = key.slice(0, 6);
            await runCalendarCacheChange(client, async () => {
              await client.cancelQueries({ queryKey });
              client.removeQueries({ queryKey });
              await removeCalendarScopePersistence(
                userId,
                connectionId,
                calendarId
              );
            });
          } else {
            await clearCalendarConnectionCache(client, userId, connectionId);
          }
        } catch {
          /* Persistence is optional. */
        }
      })();
    }
  });

  return () => {
    disposed = true;
    unsubscribe();
    for (const entry of pinned) {
      mailCache.protect(entry, false);
    }
  };
};
