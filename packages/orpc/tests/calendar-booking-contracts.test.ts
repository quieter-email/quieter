import { calendarAvailabilityInputSchema } from "@quieter/calendar/availability";
import { describe, expect, test } from "vite-plus/test";

import {
  calendarBookingBookInputSchema,
  calendarBookingCreateInputSchema,
  calendarBookingResultInputSchema,
  calendarBookingResultSchema,
  calendarBookingScopeSchema,
  calendarBookingViewInputSchema,
  calendarBookingViewSchema,
} from "../src/calendar/booking-contracts";

const personalCalendar = {
  calendarId: "personal-calendar",
  connectionId: "google-connection",
};
const workCalendar = {
  calendarId: "work-calendar",
  connectionId: "microsoft-connection",
};
const ownerInput = {
  availability: {
    calendars: [
      personalCalendar,
      { ...personalCalendar, calendarId: "shared-calendar" },
      workCalendar,
    ],
    end: "2027-03-29T13:00:00+02:00",
    limit: 20,
    preferences: {
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 15,
      durationMinutes: 30,
      stepMinutes: 15,
      workingHours: [{ endMinute: 13 * 60, startMinute: 9 * 60, weekday: 1 }],
    },
    start: "2027-03-29T09:00:00+02:00",
    timeZone: "Europe/Berlin",
  },
  destination: personalCalendar,
  expiresAt: "2027-03-29T12:00:00+02:00",
  title: "Office hours",
};
const googleBinding = {
  connectionId: personalCalendar.connectionId,
  googleSubject: "google-subject",
  mailboxId: "native-mailbox",
  provider: "google_calendar",
};
const microsoftBinding = {
  connectionId: workCalendar.connectionId,
  provider: "microsoft_calendar",
  providerAccountId: "microsoft-account",
};
const scope = {
  accountBindings: [googleBinding, microsoftBinding],
  availability: ownerInput.availability,
  destination: ownerInput.destination,
  version: 1,
};
const bookInput = {
  capability: "X0GD3H4UazJ6c-IXb5K1MF8C82Qw9b3pVyENi7rlg4k",
  guest: { name: "Alex Guest" },
  requestId: "e0ea95e7-2fa7-4ba2-9a42-6fb9a3c2cb51",
  start: "2027-03-29T10:00:00.123+02:00",
};
const slot = {
  end: "2027-03-29T10:30:00.123+02:00",
  start: bookInput.start,
};
const availableView = {
  durationMinutes: 30,
  kind: "available",
  next: "2027-03-29T11:00:00+02:00",
  slots: [slot],
  timeZone: "Europe/Berlin",
  title: ownerInput.title,
};
const confirmedResult = {
  kind: "confirmed",
  slot,
  timeZone: "Europe/Berlin",
  title: ownerInput.title,
};

describe("owner booking contracts", () => {
  test.each(["start", "end"] as const)(
    "rejects booking range %s precision that native persistence would truncate",
    (field) => {
      const availability = {
        ...ownerInput.availability,
        [field]: ownerInput.availability[field].replace("00+02", "00.0001+02"),
      };
      expect(
        calendarAvailabilityInputSchema.safeParse(availability).success
      ).toBeTruthy();
      expect(
        calendarBookingCreateInputSchema.safeParse({
          ...ownerInput,
          availability,
        }).success
      ).toBeFalsy();
      expect(
        calendarBookingScopeSchema.safeParse({ ...scope, availability }).success
      ).toBeFalsy();
    }
  );

  test("preserves the complete availability contract and normalizes the title", () => {
    const parsed = calendarBookingCreateInputSchema.parse({
      ...ownerInput,
      title: "  Office hours  ",
    });

    expect(parsed).toMatchObject({
      availability: {
        calendars: [
          personalCalendar,
          { calendarId: "shared-calendar" },
          workCalendar,
        ],
        end: "2027-03-29T13:00:00+02:00",
        limit: 20,
        preferences: {
          bufferAfterMinutes: 10,
          bufferBeforeMinutes: 15,
          stepMinutes: 15,
          workingHours: [{ endMinute: 780, startMinute: 540, weekday: 1 }],
        },
        timeZone: "Europe/Berlin",
      },
      title: "Office hours",
    });
  });

  test.each(["userId", "scope", "accountBindings", "mailboxId", "event"])(
    "rejects client-supplied private authority in %s",
    (field) => {
      expect(
        calendarBookingCreateInputSchema.safeParse({
          ...ownerInput,
          [field]: field === "scope" ? scope : "forged",
        }).success
      ).toBeFalsy();
    }
  );

  test.each([
    { ...personalCalendar, calendarId: "unchecked-calendar" },
    { ...personalCalendar, connectionId: "unchecked-connection" },
    { ...personalCalendar, userId: "forged-owner" },
  ])(
    "rejects a destination outside the explicit calendar set",
    (destination) => {
      expect(
        calendarBookingCreateInputSchema.safeParse({
          ...ownerInput,
          destination,
        }).success
      ).toBeFalsy();
    }
  );

  test("compares expiry as an instant and leaves current-time validity to the service", () => {
    expect(
      calendarBookingCreateInputSchema.safeParse({
        ...ownerInput,
        expiresAt: "2027-03-29T11:00:00Z",
      }).success
    ).toBeTruthy();
    expect(
      calendarBookingCreateInputSchema.safeParse({
        ...ownerInput,
        expiresAt: "2027-03-29T11:00:00.001Z",
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingCreateInputSchema.safeParse({
        ...ownerInput,
        expiresAt: "2000-01-01T00:00:00Z",
      }).success
    ).toBeTruthy();
  });

  test.each([
    { ...ownerInput.availability, end: ownerInput.availability.start },
    { ...ownerInput.availability, end: "2027-04-30T13:00:00+02:00" },
    {
      ...ownerInput.availability,
      calendars: [personalCalendar, personalCalendar],
    },
    { ...ownerInput.availability, userId: "forged-owner" },
  ])("rejects invalid or widened availability", (availability) => {
    expect(
      calendarBookingCreateInputSchema.safeParse({
        ...ownerInput,
        availability,
      }).success
    ).toBeFalsy();
  });

  test("binds each connection once even when it supplies several calendars", () => {
    const parsed = calendarBookingScopeSchema.parse(scope);

    expect(parsed.accountBindings).toContainEqual(googleBinding);
    expect(parsed.accountBindings).toContainEqual(microsoftBinding);
    expect(parsed.availability.calendars).toContainEqual({
      ...personalCalendar,
      calendarId: "shared-calendar",
    });
  });

  test.each([
    [],
    [googleBinding],
    [googleBinding, googleBinding, microsoftBinding],
    [googleBinding, { ...microsoftBinding, connectionId: "other-connection" }],
    [
      googleBinding,
      microsoftBinding,
      { ...googleBinding, connectionId: "extra" },
    ],
    [
      {
        connectionId: personalCalendar.connectionId,
        provider: "google_calendar",
      },
      microsoftBinding,
    ],
    [
      { ...googleBinding, providerAccountId: "foreign-account" },
      microsoftBinding,
    ],
    [googleBinding, { ...microsoftBinding, mailboxId: "foreign-mailbox" }],
  ])(
    "rejects missing, duplicate, extra, or mixed-provider bindings",
    (...accountBindings) => {
      expect(
        calendarBookingScopeSchema.safeParse({
          ...scope,
          accountBindings,
        }).success
      ).toBeFalsy();
    }
  );

  test("rejects unresolved primary aliases in stored scope", () => {
    const primary = { ...personalCalendar, calendarId: "primary" };
    const input = {
      ...ownerInput,
      availability: { ...ownerInput.availability, calendars: [primary] },
      destination: primary,
    };

    expect(
      calendarBookingCreateInputSchema.safeParse(input).success
    ).toBeTruthy();
    expect(
      calendarBookingScopeSchema.safeParse({
        ...scope,
        accountBindings: [googleBinding],
        availability: input.availability,
        destination: primary,
      }).success
    ).toBeFalsy();
  });

  test("rejects stored scope changes that add authority or change the destination", () => {
    expect(
      calendarBookingScopeSchema.safeParse({ ...scope, userId: "forged-owner" })
        .success
    ).toBeFalsy();
    expect(
      calendarBookingScopeSchema.safeParse({
        ...scope,
        destination: { ...personalCalendar, calendarId: "unchecked-calendar" },
      }).success
    ).toBeFalsy();
  });
});

describe("guest booking inputs", () => {
  test("trims contact text and preserves notes, email spelling, and offsets", () => {
    const parsed = calendarBookingBookInputSchema.parse({
      ...bookInput,
      guest: {
        email: "  Alex@Example.com  ",
        name: "  Alex Guest  ",
        note: "  <strong>Bring a draft</strong>\nPlease review it.  ",
      },
    });

    expect(parsed).toMatchObject({
      guest: {
        email: "Alex@Example.com",
        name: "Alex Guest",
        note: "<strong>Bring a draft</strong>\nPlease review it.",
      },
      start: "2027-03-29T10:00:00.123+02:00",
    });
    const withoutContact = calendarBookingBookInputSchema.parse(bookInput);
    expect(withoutContact.guest).not.toHaveProperty("email");
    expect(withoutContact.guest).not.toHaveProperty("note");
  });

  test.each(["userId", "calendarId", "connectionId", "scope", "event", "end"])(
    "rejects guest-supplied booking authority in %s",
    (field) => {
      expect(
        calendarBookingBookInputSchema.safeParse({
          ...bookInput,
          [field]: "forged",
        }).success
      ).toBeFalsy();
    }
  );

  test.each([
    { name: "   " },
    { name: "a".repeat(101) },
    { email: "not-an-email", name: "Alex" },
    {
      email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`,
      name: "Alex",
    },
    { name: "Alex", note: "a".repeat(1001) },
    { name: "Alex", verified: true },
    { attendees: [{ email: "guest@example.com" }], name: "Alex" },
  ])(
    "rejects unbounded, invalid, or authority-bearing guest details",
    (guest) => {
      expect(
        calendarBookingBookInputSchema.safeParse({ ...bookInput, guest })
          .success
      ).toBeFalsy();
    }
  );

  test.each([
    ` ${bookInput.capability}`,
    `${bookInput.capability}=`,
    bookInput.capability.slice(1),
    `${bookInput.capability.slice(0, -1)}l`,
    `${bookInput.capability.slice(0, -1)}/`,
  ])("rejects malformed or noncanonical capabilities", (capability) => {
    expect(
      calendarBookingBookInputSchema.safeParse({ ...bookInput, capability })
        .success
    ).toBeFalsy();
  });

  test.each([
    "e0ea95e7-2fa7-1ba2-9a42-6fb9a3c2cb51",
    "e0ea95e7-2fa7-7ba2-9a42-6fb9a3c2cb51",
    "e0ea95e7-2fa7-4ba2-1a42-6fb9a3c2cb51",
    "00000000-0000-0000-0000-000000000000",
  ])("requires a UUIDv4 request identity", (requestId) => {
    expect(
      calendarBookingResultInputSchema.safeParse({
        capability: bookInput.capability,
        requestId,
      }).success
    ).toBeFalsy();
  });

  test.each([
    "2027-03-29T10:00:00.1234+02:00",
    "2027-03-29T10:00:00",
    "2027-02-29T10:00:00Z",
  ])("rejects ambiguous, invalid, or overly precise start times", (start) => {
    expect(
      calendarBookingBookInputSchema.safeParse({ ...bookInput, start }).success
    ).toBeFalsy();
  });

  test("limits view and receipt lookup to their bearer and opaque cursor or identity", () => {
    expect(
      calendarBookingViewInputSchema.parse({
        after: availableView.next,
        capability: bookInput.capability,
      })
    ).toMatchObject({ after: "2027-03-29T11:00:00+02:00" });
    expect(
      calendarBookingResultInputSchema.safeParse({
        capability: bookInput.capability,
        requestId: bookInput.requestId,
      }).success
    ).toBeTruthy();
    expect(
      calendarBookingViewInputSchema.safeParse({
        calendarId: "forged-calendar",
        capability: bookInput.capability,
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingResultInputSchema.safeParse({
        capability: bookInput.capability,
        guest: bookInput.guest,
        requestId: bookInput.requestId,
      }).success
    ).toBeFalsy();
  });
});

describe("public booking projections", () => {
  test("preserves intentional display information and optional pagination", () => {
    expect(calendarBookingViewSchema.parse(availableView)).toMatchObject({
      next: "2027-03-29T11:00:00+02:00",
      slots: [{ start: "2027-03-29T10:00:00.123+02:00" }],
      timeZone: "Europe/Berlin",
      title: "Office hours",
    });
    expect(calendarBookingResultSchema.parse(confirmedResult)).toMatchObject({
      kind: "confirmed",
      slot: { end: "2027-03-29T10:30:00.123+02:00" },
    });
    expect(
      calendarBookingViewSchema.safeParse({ kind: "unavailable" }).success
    ).toBeTruthy();
    expect(
      calendarBookingResultSchema.safeParse({ kind: "pending" }).success
    ).toBeTruthy();
    expect(
      calendarBookingResultSchema.safeParse({ kind: "unavailable" }).success
    ).toBeTruthy();
  });

  test.each([
    "userId",
    "calendarId",
    "connectionId",
    "eventId",
    "provider",
    "accountBindings",
    "coverage",
    "guest",
    "attendees",
    "email",
  ])("rejects private %s fields in successful public projections", (field) => {
    expect(
      calendarBookingViewSchema.safeParse({
        ...availableView,
        [field]: "private",
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingResultSchema.safeParse({
        ...confirmedResult,
        [field]: "private",
      }).success
    ).toBeFalsy();
  });

  test("rejects private nested data and diagnostic details in generic outcomes", () => {
    expect(
      calendarBookingViewSchema.safeParse({
        ...availableView,
        slots: [{ ...slot, eventId: "private-event" }],
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingResultSchema.safeParse({
        ...confirmedResult,
        slot: { ...slot, guest: bookInput.guest },
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingViewSchema.safeParse({
        kind: "unavailable",
        reason: "private-provider-failure",
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingResultSchema.safeParse({
        kind: "pending",
        reservationId: "private-reservation",
      }).success
    ).toBeFalsy();
  });

  test("rejects reversed, shortened, or overly precise public slots", () => {
    expect(
      calendarBookingResultSchema.safeParse({
        ...confirmedResult,
        slot: { end: slot.start, start: slot.end },
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingViewSchema.safeParse({
        ...availableView,
        slots: [{ ...slot, end: "2027-03-29T10:15:00.123+02:00" }],
      }).success
    ).toBeFalsy();
    expect(
      calendarBookingResultSchema.safeParse({
        ...confirmedResult,
        slot: { ...slot, end: "2027-03-29T10:30:00.1234+02:00" },
      }).success
    ).toBeFalsy();
  });
});
