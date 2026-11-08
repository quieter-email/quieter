import { getCalendarLink } from "@quieter/app/features/message-thread/domain/mail-html";
import { describe, expect, test } from "vite-plus/test";

describe("calendar links", () => {
  test("rejects unsupported, spoofed, and unsafe links", () => {
    expect(
      getCalendarLink("https://example.com/calendar/event?eid=event-id")
    ).toBeNull();
    expect(
      getCalendarLink(
        "https://calendar.google.com.evil.example/calendar/event?eid=event-id"
      )
    ).toBeNull();
    expect(getCalendarLink("javascript:alert(1)")).toBeNull();
  });
});
