import { describe, expect, test } from "vite-plus/test";
import { getCalendarLink, getCalendarLinks, linkifyText } from "./mail-html";

describe("linkifyText", () => {
  test("turns bare http urls into link segments", () => {
    expect(
      linkifyText(
        "Join https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1 now",
      ),
    ).toEqual([
      { kind: "text", value: "Join " },
      {
        kind: "link",
        href: "https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1",
        value: "https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1",
      },
      { kind: "text", value: " now" },
    ]);
  });

  test("keeps trailing sentence punctuation outside the link", () => {
    expect(linkifyText("Open https://example.com/path?token=abc123.")).toEqual([
      { kind: "text", value: "Open " },
      {
        kind: "link",
        href: "https://example.com/path?token=abc123",
        value: "https://example.com/path?token=abc123",
      },
      { kind: "text", value: "." },
    ]);
  });
});

describe("calendar links", () => {
  test("recognizes supported Google, Outlook, and ICS event links", () => {
    expect(
      getCalendarLink("https://calendar.google.com/calendar/render?action=TEMPLATE&text=Planning"),
    ).toEqual({
      href: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Planning",
      label: "Open in Google Calendar",
    });
    expect(
      getCalendarLink("https://outlook.office.com/calendar/0/deeplink/compose?subject=Planning"),
    ).toEqual({
      href: "https://outlook.office.com/calendar/0/deeplink/compose?subject=Planning",
      label: "Open in Outlook Calendar",
    });
    expect(getCalendarLink("https://events.example.com/invites/planning.ics")).toEqual({
      href: "https://events.example.com/invites/planning.ics",
      label: "Open calendar invite",
    });
  });

  test("rejects unsupported, spoofed, and unsafe links", () => {
    expect(getCalendarLink("https://example.com/calendar/event?eid=event-id")).toBeNull();
    expect(
      getCalendarLink("https://calendar.google.com.evil.example/calendar/event?eid=event-id"),
    ).toBeNull();
    expect(getCalendarLink("javascript:alert(1)")).toBeNull();
  });

  test("deduplicates and bounds calendar actions", () => {
    expect(
      getCalendarLinks([
        "https://events.example.com/first.ics",
        "https://events.example.com/first.ics",
        "https://events.example.com/second.ics",
        "https://events.example.com/third.ics",
        "https://events.example.com/fourth.ics",
      ]),
    ).toEqual([
      { href: "https://events.example.com/first.ics", label: "Open calendar invite" },
      { href: "https://events.example.com/second.ics", label: "Open calendar invite" },
      { href: "https://events.example.com/third.ics", label: "Open calendar invite" },
    ]);
  });
});
