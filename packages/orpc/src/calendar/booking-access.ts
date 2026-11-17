import { ORPCError } from "@orpc/server";
import type { CalendarRef, CalendarSummary } from "@quieter/calendar";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  connectorCredential,
  gmailCredential,
  mailbox,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq } from "drizzle-orm";

import { hasRequiredConnectorScopes } from "../connectors/runtime";
import { CALENDAR_SCOPES } from "../gmail-mailbox-access";
import type {
  CalendarBookingCreateInput,
  CalendarBookingScope,
} from "./booking-contracts";
import { calendarBookingScopeSchema } from "./booking-contracts";
import { getCalendarAccountForUser, listCalendarsForUser } from "./service";

type AccountBinding = CalendarBookingScope["accountBindings"][number];
const unavailableMessage =
  "These calendars are no longer available. Choose your calendars again.";

const readNativeAccountBinding = async ({
  account,
  executor,
  lock,
  userId,
}: {
  account: Pick<AccountBinding, "connectionId" | "provider">;
  executor: DatabaseExecutor;
  lock: boolean;
  userId: string;
}): Promise<AccountBinding> => {
  if (account.provider === "google_calendar") {
    const mailboxQuery = executor
      .select({ id: mailbox.id, status: mailbox.status })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.id, account.connectionId),
          eq(mailbox.ownerUserId, userId),
          eq(mailbox.provider, "gmail")
        )
      )
      .limit(1);
    const [ownedMailbox] = lock
      ? await mailboxQuery.for("share")
      : await mailboxQuery;
    if (ownedMailbox === undefined || ownedMailbox.status !== "connected") {
      throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
    }
    const credentialQuery = executor
      .select({
        googleSubject: gmailCredential.googleSubject,
        mailboxId: gmailCredential.mailboxId,
        scopes: gmailCredential.scopes,
      })
      .from(gmailCredential)
      .innerJoin(mailbox, eq(gmailCredential.mailboxId, mailbox.id))
      .where(
        and(
          eq(mailbox.id, account.connectionId),
          eq(mailbox.ownerUserId, userId),
          eq(mailbox.provider, "gmail")
        )
      )
      .limit(1);
    const [credential] = lock
      ? await credentialQuery.for("share", { of: gmailCredential })
      : await credentialQuery;
    const scopes = new Set((credential?.scopes ?? "").split(/\s+/u));
    if (
      credential === undefined ||
      !CALENDAR_SCOPES.every((scope) => scopes.has(scope))
    ) {
      throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
    }
    return {
      connectionId: ownedMailbox.id,
      googleSubject: credential.googleSubject,
      mailboxId: credential.mailboxId,
      provider: "google_calendar",
    };
  }
  const credentialQuery = executor
    .select({
      id: connectorCredential.id,
      providerAccountId: connectorCredential.providerAccountId,
      scopes: connectorCredential.scopes,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.id, account.connectionId),
        eq(connectorCredential.userId, userId),
        eq(connectorCredential.provider, "microsoft_calendar")
      )
    )
    .limit(1);
  const [credential] = lock
    ? await credentialQuery.for("share")
    : await credentialQuery;
  if (
    credential === undefined ||
    credential.status !== "connected" ||
    !hasRequiredConnectorScopes("microsoft_calendar", credential.scopes)
  ) {
    throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
  }
  return {
    connectionId: credential.id,
    provider: "microsoft_calendar",
    providerAccountId: credential.providerAccountId,
  };
};

export const assertCalendarBookingAccountBindings = async (input: {
  executor: DatabaseExecutor;
  scope: CalendarBookingScope;
  userId: string;
}): Promise<void> => {
  try {
    const scope = calendarBookingScopeSchema.parse(input.scope);
    const bindings = scope.accountBindings.toSorted(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.connectionId.localeCompare(right.connectionId)
    );
    for (const binding of bindings) {
      if (
        binding.provider === "google_calendar" &&
        binding.connectionId !== binding.mailboxId
      ) {
        throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
      }
      const current = await readNativeAccountBinding({
        account: binding,
        executor: input.executor,
        lock: true,
        userId: input.userId,
      });
      if (
        current.connectionId !== binding.connectionId ||
        current.provider !== binding.provider ||
        (binding.provider === "google_calendar" &&
          (current.provider !== "google_calendar" ||
            current.googleSubject !== binding.googleSubject ||
            current.mailboxId !== binding.mailboxId)) ||
        (binding.provider === "microsoft_calendar" &&
          (current.provider !== "microsoft_calendar" ||
            current.providerAccountId !== binding.providerAccountId))
      ) {
        throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
      }
    }
  } catch (error) {
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(new Error("Booking account access could not be checked."), {
        operation: "calendar:booking-access",
      });
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The selected calendars could not be checked. Try again.",
      });
    }
    throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
  }
};

export const resolveCalendarBookingScopeForUser = async (
  input: CalendarBookingCreateInput & {
    signal?: AbortSignal;
    userId: string;
  }
): Promise<CalendarBookingScope> => {
  try {
    input.signal?.throwIfAborted();
    const aliases = new Map<string, string>();
    const bindings = new Map<string, AccountBinding>();
    for (const connectionId of new Set(
      input.availability.calendars.map((calendar) => calendar.connectionId)
    )) {
      const account = await getCalendarAccountForUser({
        connectionId,
        signal: input.signal,
        userId: input.userId,
      });
      if (account.status !== "connected") {
        throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
      }
      const nativeConnectionId =
        account.provider === "microsoft_calendar"
          ? account.id
          : account.mailboxId;
      aliases.set(connectionId, nativeConnectionId);
      if (!bindings.has(nativeConnectionId)) {
        const binding = await readNativeAccountBinding({
          account: {
            connectionId: nativeConnectionId,
            provider:
              account.provider === "microsoft_calendar"
                ? "microsoft_calendar"
                : "google_calendar",
          },
          executor: db,
          lock: false,
          userId: input.userId,
        });
        bindings.set(nativeConnectionId, binding);
      }
    }

    const available = new Map<string, CalendarSummary[]>();
    for (const connectionId of bindings.keys()) {
      input.signal?.throwIfAborted();
      const { calendars } = await listCalendarsForUser({
        connectionId,
        signal: input.signal,
        userId: input.userId,
      });
      available.set(connectionId, calendars);
    }
    const calendars: CalendarRef[] = [];
    let destination: CalendarRef | undefined;
    for (const selected of input.availability.calendars) {
      const connectionId = aliases.get(selected.connectionId);
      const selectedCalendar =
        connectionId === undefined
          ? undefined
          : available
              .get(connectionId)
              ?.find((calendar) =>
                selected.calendarId === "primary"
                  ? calendar.primary
                  : calendar.calendarId === selected.calendarId
              );
      if (
        connectionId === undefined ||
        selectedCalendar === undefined ||
        selectedCalendar.connectionId !== connectionId
      ) {
        throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
      }
      const normalized = {
        calendarId: selectedCalendar.calendarId,
        connectionId,
      };
      if (
        selected.connectionId === input.destination.connectionId &&
        selected.calendarId === input.destination.calendarId
      ) {
        if (
          selectedCalendar.access !== "write" &&
          selectedCalendar.access !== "owner"
        ) {
          throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
        }
        destination = normalized;
      }
      if (
        !calendars.some(
          (calendar) =>
            calendar.connectionId === normalized.connectionId &&
            calendar.calendarId === normalized.calendarId
        )
      ) {
        calendars.push(normalized);
      }
    }
    if (destination === undefined) {
      throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
    }
    const scope = calendarBookingScopeSchema.parse({
      accountBindings: [...bindings.values()],
      availability: { ...input.availability, calendars },
      destination,
      version: 1,
    });
    input.signal?.throwIfAborted();
    await assertCalendarBookingAccountBindings({
      executor: db,
      scope,
      userId: input.userId,
    });
    return scope;
  } catch (error) {
    input.signal?.throwIfAborted();
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(new Error("Booking calendar scope could not be checked."), {
        operation: "calendar:booking-scope",
      });
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The selected calendars could not be checked. Try again.",
      });
    }
    throw new ORPCError("FORBIDDEN", { message: unavailableMessage });
  }
};
