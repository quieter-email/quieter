import { describe, expect, test } from "vite-plus/test";

import {
  boundAgentToolOutput,
  getAgentEffectView,
} from "../src/mail-agent/results";

const effect = (result: unknown) => ({
  createdAt: new Date(),
  id: "effect",
  inputDigest: "digest",
  mailboxId: "mailbox",
  result,
  runId: "run",
  status: "completed" as const,
  toolCallId: "call",
  toolId: "account:linear.save_issue",
  updatedAt: new Date(),
});

describe("private effect results", () => {
  test("keeps continuation fields usable when calendar event details exceed the output limit", () => {
    const nextPageToken = "follow-up-page";
    const timeMin = new Date().toISOString();
    const output = boundAgentToolOutput({
      calendarId: "primary",
      currentDate: "2026-10-25",
      events: [{ description: "event detail ".repeat(6000), id: "event-id" }],
      fetchedAt: new Date().toISOString(),
      nextPageToken,
      partial: true,
      status: "success",
      timeMin,
      timeZone: "Europe/Berlin",
    });
    expect(output).toMatchObject({
      currentDate: "2026-10-25",
      nextPageToken,
      partial: true,
      timeMin,
      timeZone: "Europe/Berlin",
      truncated: true,
    });
    expect(JSON.stringify(output)).not.toContain("event detail ".repeat(6000));
  });

  test("compacts large mutation results before truncation so confirmed identities stay reviewable", () => {
    const output = boundAgentToolOutput({
      content: [
        {
          text: JSON.stringify({
            description: "private detail ".repeat(6000),
            id: "issue-id",
            title: "Requested task",
            url: "https://linear.app/team/issue/TEAM-42",
          }),
          type: "text",
        },
      ],
    });
    expect(getAgentEffectView(effect(output), [])).toMatchObject({
      externalId: "issue-id",
      status: "completed",
      title: "Requested task",
      url: "https://linear.app/team/issue/TEAM-42",
    });
    expect(JSON.stringify(output)).not.toContain(
      "private detail ".repeat(6000)
    );
  });

  test("keeps confirmed result identity reviewable without exposing raw provider fields", () => {
    const result = getAgentEffectView(
      effect({
        content: [
          {
            text: JSON.stringify({
              id: "issue-id",
              privateBody: "private details",
              title: "Requested task",
              url: "https://linear.app/team/issue/TEAM-42",
            }),
            type: "text",
          },
        ],
      }),
      [{ label: "Save issue", toolId: "linear.save_issue" }]
    );
    expect(result).toMatchObject({
      externalId: "issue-id",
      status: "completed",
      title: "Requested task",
      url: "https://linear.app/team/issue/TEAM-42",
    });
    expect(JSON.stringify(result)).not.toContain("private details");
  });

  test("preserves a native calendar result's event identity and link through compaction", () => {
    const output = boundAgentToolOutput({
      action: "created",
      calendarId: "work@example.test",
      event: {
        description: "Calendar details. ".repeat(1000),
        eventId: "event-id",
        title: "Requested appointment",
        webUrl: "https://www.google.com/calendar/event?eid=synthetic-event",
      },
      eventId: "event-id",
      status: "success",
    });
    expect(getAgentEffectView(effect(output), [])).toMatchObject({
      externalId: "event-id",
      title: "Requested appointment",
      url: "https://www.google.com/calendar/event?eid=synthetic-event",
    });
  });

  test.each([
    // oxlint-disable-next-line eslint/no-script-url -- Exercise rejection of executable provider result URLs.
    "javascript:alert(1)",
    "https://linear.app.evil.test/issue",
    "https://example.test/private",
    "https://www.google.com/url?redirect=example.test",
  ])("does not render untrusted result links", (url) => {
    expect(
      getAgentEffectView(effect({ id: "issue-id", url }), []).url
    ).toBeNull();
  });
});
