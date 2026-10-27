import type { CalendarAccount, CalendarSummary } from "@quieter/calendar";
import { describe, expect, it } from "vite-plus/test";

import { getCalendarRefKey } from "./calendar-event-form";
import {
  getCalendarGroups,
  toggleCalendarGroupVisibility,
} from "./calendar-groups";

const accounts: CalendarAccount[] = ["first", "second"].map((id) => ({
  email: `${id}@example.com`,
  id,
  mailboxId: `mailbox-${id}`,
  name: id,
  status: "connected",
}));
const holiday: CalendarSummary = {
  access: "read",
  calendarId: "en.german#holiday@group.v.calendar.google.com",
  connectionId: "first",
  name: "Holidays",
  primary: false,
  selected: true,
  supportsMeetings: false,
  timeZone: "Europe/Berlin",
};
const secondHoliday = { ...holiday, connectionId: "second" };

describe("calendar groups", () => {
  it("uses one deterministic source for identical read-only calendars", () => {
    const groups = getCalendarGroups({
      accounts,
      calendars: [secondHoliday, { ...holiday, name: "Feiertage" }],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.calendar.connectionId).toBe("first");
    expect(groups[0]?.keys).toContain(getCalendarRefKey(secondHoliday));
  });

  it("keeps matching names, writable calendars, primary calendars and busy-only access separate", () => {
    const calendars: CalendarSummary[] = [
      holiday,
      { ...secondHoliday, calendarId: "another-holiday-calendar" },
      { ...secondHoliday, access: "write" },
      { ...holiday, access: "owner", calendarId: "owned" },
      { ...secondHoliday, access: "owner", calendarId: "owned" },
      { ...holiday, calendarId: "primary", primary: true },
      { ...secondHoliday, calendarId: "primary", primary: true },
      { ...holiday, calendarId: "availability" },
      { ...secondHoliday, access: "busy", calendarId: "availability" },
    ];
    expect(getCalendarGroups({ accounts, calendars })).toHaveLength(
      calendars.length
    );
  });

  it("hides every alias when any alias is visible and restores the whole group", () => {
    const groups = getCalendarGroups({
      accounts,
      calendars: [holiday, secondHoliday],
    });
    const hiddenCalendarKeys = toggleCalendarGroupVisibility({
      calendar: holiday,
      groups,
      hiddenCalendarKeys: [getCalendarRefKey(holiday), "unrelated"],
    });
    expect(hiddenCalendarKeys).toContain(getCalendarRefKey(holiday));
    expect(hiddenCalendarKeys).toContain(getCalendarRefKey(secondHoliday));
    expect(
      toggleCalendarGroupVisibility({
        calendar: holiday,
        groups,
        hiddenCalendarKeys,
      })
    ).toStrictEqual(["unrelated"]);
  });

  it("prefers an account with access and falls back when the canonical account is removed", () => {
    const calendars = [holiday, secondHoliday];
    const disconnectedAccounts = accounts.map((account): CalendarAccount =>
      account.id === "first"
        ? { ...account, mailboxId: "mailbox-first", status: "needs-reconnect" }
        : account
    );
    expect(
      getCalendarGroups({ accounts: disconnectedAccounts, calendars })[0]
        ?.calendar.connectionId
    ).toBe("second");
    const remaining = getCalendarGroups({
      accounts: accounts.filter((account) => account.id !== "first"),
      calendars,
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.calendar.connectionId).toBe("second");
    expect(remaining[0]?.keys).not.toContain(getCalendarRefKey(holiday));
  });
});
