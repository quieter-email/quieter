import { ORPCError } from "@orpc/server";
import type { deleteCookie, setCookie } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { reportServerError } from "#/lib/server-error-reporting";

import "../routes/api/gmail.callback";

type CallbackHandler = (input: { request: Request }) => Promise<Response>;

const fixtures = vi.hoisted(() => {
  const route: { handle: CallbackHandler | null } = { handle: null };
  return {
    complete: vi.fn<() => Promise<{ mailboxId: string; returnTo: string }>>(),
    context:
      vi.fn<
        () => Promise<{ mailboxId: string | null; returnTo: string } | null>
      >(),
    report: vi.fn<typeof reportServerError>(),
    route,
    setCookie: vi.fn<typeof setCookie>(),
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Capture the HTTP handler without starting a browser router.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () => (options: { server: { handlers: { GET: CallbackHandler } } }) => {
      fixtures.route.handle = options.server.handlers.GET;
      return options;
    },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The handler writes cookies through the server request context.
vi.mock("@tanstack/react-start/server", () => ({
  deleteCookie: vi.fn<typeof deleteCookie>(),
  setCookie: fixtures.setCookie,
}));
vi.mock(import("@quieter/orpc/mailbox"), () => ({
  completeGmailOAuth: fixtures.complete,
  getGmailOAuthCallbackContext: fixtures.context,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Replace boundary reporting to inspect unexpected failures.
vi.mock("#/lib/server-error-reporting", () => ({
  reportServerError: fixtures.report,
}));

describe("Gmail OAuth callback navigation", () => {
  beforeEach(() => {
    fixtures.complete.mockReset().mockResolvedValue({
      mailboxId: "owned-mailbox",
      returnTo: "/?workspace=calendar&calendarView=week",
    });
    fixtures.context.mockReset().mockResolvedValue({
      mailboxId: "owned-mailbox",
      returnTo: "/?workspace=calendar&calendarView=week",
    });
    fixtures.report.mockReset();
    fixtures.setCookie.mockReset();
  });

  test.each(["?error=access_denied&state=owned-state", "?state=owned-state"])(
    "returns to the stored calendar route after cancellation %s",
    async (query) => {
      const { handle } = fixtures.route;
      if (handle === null) {
        throw new Error("Missing Gmail callback handler.");
      }
      const response = await handle({
        request: new Request(
          `https://quieter.example/api/gmail/callback${query}`
        ),
      });
      const redirect = new URL(response.headers.get("location") ?? "");
      expect(redirect.origin).toBe("https://quieter.example");
      expect(redirect.pathname).toBe("/");
      expect(redirect.searchParams.get("workspace")).toBe("calendar");
      expect(redirect.searchParams.get("calendarView")).toBe("week");
      expect(redirect.searchParams.get("gmail")).toBe("error");
      expect(fixtures.complete).not.toHaveBeenCalled();
      expect(fixtures.setCookie).not.toHaveBeenCalled();
      expect(fixtures.report).not.toHaveBeenCalled();
    }
  );

  test("preserves stored navigation when completion rejects an expired request", async () => {
    fixtures.complete.mockRejectedValueOnce(
      new ORPCError("BAD_REQUEST", { message: "Connection request expired." })
    );
    const { handle } = fixtures.route;
    if (handle === null) {
      throw new Error("Missing Gmail callback handler.");
    }
    const response = await handle({
      request: new Request(
        "https://quieter.example/api/gmail/callback?code=grant&state=owned-state"
      ),
    });
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.pathname).toBe("/");
    expect(redirect.searchParams.get("workspace")).toBe("calendar");
    expect(redirect.searchParams.get("gmail")).toBe("error");
    expect(fixtures.setCookie).toHaveBeenCalledWith(
      "gmail-callback-error",
      expect.stringContaining("Connection request expired."),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: true })
    );
    expect(fixtures.report).not.toHaveBeenCalled();
  });

  test("falls back to mailbox settings when no owned state is available", async () => {
    fixtures.context.mockResolvedValueOnce(null);
    const { handle } = fixtures.route;
    if (handle === null) {
      throw new Error("Missing Gmail callback handler.");
    }
    const response = await handle({
      request: new Request(
        "https://quieter.example/api/gmail/callback?error=access_denied&state=foreign-state"
      ),
    });
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.pathname).toBe("/settings");
    expect(redirect.searchParams.get("tab")).toBe("mailboxes");
    expect(redirect.searchParams.has("mailboxId")).toBeFalsy();
    expect(fixtures.complete).not.toHaveBeenCalled();
  });

  test.each([
    "/?workspace=calendar&calendarView=week&calendarDate=2026-10-25&calendarConnectionId=calendar-account&calendarId=primary&calendarEventId=event&mailboxId=active-mailbox#selected-event",
    "/?mailboxId=active-mailbox&messageId=invitation-message&threadId=invitation-thread&query=invitation",
  ])(
    "preserves the Calendar or invitation destination after success %s",
    async (returnTo) => {
      fixtures.complete.mockResolvedValueOnce({
        mailboxId: "reconnected-mailbox",
        returnTo,
      });
      const { handle } = fixtures.route;
      if (handle === null) {
        throw new Error("Missing Gmail callback handler.");
      }
      const response = await handle({
        request: new Request(
          "https://quieter.example/api/gmail/callback?code=grant&state=owned-state"
        ),
      });
      const redirect = new URL(response.headers.get("location") ?? "");
      const expected = new URL(returnTo, "https://quieter.example");
      expected.searchParams.set("gmail", "connected");
      expect(redirect.href).toBe(expected.href);
      expect(redirect.searchParams.has("gmailLink")).toBeFalsy();
      expect(redirect.searchParams.get("mailboxId")).toBe("active-mailbox");
    }
  );

  test("preserves the invitation destination after consent is canceled", async () => {
    const returnTo =
      "/?mailboxId=active-mailbox&messageId=invitation-message&threadId=invitation-thread";
    fixtures.context.mockResolvedValueOnce({
      mailboxId: "owned-mailbox",
      returnTo,
    });
    const { handle } = fixtures.route;
    if (handle === null) {
      throw new Error("Missing Gmail callback handler.");
    }
    const response = await handle({
      request: new Request(
        "https://quieter.example/api/gmail/callback?error=access_denied&state=owned-state"
      ),
    });
    const expected = new URL(returnTo, "https://quieter.example");
    expected.searchParams.set("gmail", "error");
    expect(response.headers.get("location")).toBe(expected.href);
    expect(fixtures.complete).not.toHaveBeenCalled();
  });

  test("keeps initial Gmail setup completion for a bare mailbox landing", async () => {
    fixtures.complete.mockResolvedValueOnce({
      mailboxId: "new-mailbox",
      returnTo: "/",
    });
    const { handle } = fixtures.route;
    if (handle === null) {
      throw new Error("Missing Gmail callback handler.");
    }
    const response = await handle({
      request: new Request(
        "https://quieter.example/api/gmail/callback?code=grant&state=owned-state"
      ),
    });
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.searchParams.get("gmailLink")).toBe("complete");
    expect(redirect.searchParams.get("mailboxId")).toBe("new-mailbox");
  });
});
