import { ORPCError } from "@orpc/server";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { describe, expect, test, vi } from "vite-plus/test";

import type { ControlAuthorizationServices } from "../src/control/authority";
import {
  controlContracts,
  controlDiscoveryOutputSchema,
  controlErrorSchema,
} from "../src/control/contracts";
import { handleControlHttpRequest } from "../src/control/http";
import {
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "../src/control/openapi";
import { createControlReadRuntime } from "../src/control/runtime";
import type { ControlReadServices } from "../src/control/runtime";

const mailboxTarget = {
  kind: "mailbox",
  mailboxId: "mailbox-a",
  organizationId: "team-a",
} as const;

const createFixture = () => {
  const authorizationServices: ControlAuthorizationServices = {
    assertCalendarAccess: vi
      .fn<ControlAuthorizationServices["assertCalendarAccess"]>()
      .mockResolvedValue(),
    assertOrganizationAccess: vi
      .fn<ControlAuthorizationServices["assertOrganizationAccess"]>()
      .mockResolvedValue(),
    getMailboxAccess: vi
      .fn<ControlAuthorizationServices["getMailboxAccess"]>()
      .mockResolvedValue({
        capabilities: getMailboxCapabilities({
          provider: "managed",
          role: "reader",
        }),
        organizationId: "team-a",
      }),
    getSession: vi
      .fn<ControlAuthorizationServices["getSession"]>()
      .mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: "session-a",
        userId: "user-a",
      }),
  };
  const message = {
    attachments: [
      {
        attachmentId: "attachment-a",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 10,
      },
    ],
    bodyText: "Current authorized message.",
    id: "message-a",
    isImportant: true,
    isUnread: false,
    replyTo: "reply@example.test",
    threadId: "thread-a",
    threadMessageCount: 2,
    unsubscribeStatus: "requested" as const,
  };
  const services = {
    "calendar.accounts": vi
      .fn<ControlReadServices["calendar.accounts"]>()
      .mockResolvedValue({
        accounts: [],
        googleConfigured: true,
        isConfigured: true,
        microsoftConfigured: false,
      }),
    "calendar.event": vi
      .fn<ControlReadServices["calendar.event"]>()
      .mockRejectedValue(new ORPCError("NOT_FOUND")),
    "calendar.events": vi
      .fn<ControlReadServices["calendar.events"]>()
      .mockResolvedValue({ events: [] }),
    "calendar.list": vi
      .fn<ControlReadServices["calendar.list"]>()
      .mockResolvedValue({ calendars: [] }),
    "mail.read_thread": vi
      .fn<ControlReadServices["mail.read_thread"]>()
      .mockResolvedValue({ messages: [message], threadId: "thread-a" }),
    "mail.search": vi
      .fn<ControlReadServices["mail.search"]>()
      .mockResolvedValue({
        messages: [message],
        nextPageToken: "opaque-next-page",
        resultSizeEstimate: 3,
      }),
    "mailboxes.list": vi
      .fn<ControlReadServices["mailboxes.list"]>()
      .mockResolvedValue({ defaultMailboxId: null, groups: [] }),
  } satisfies ControlReadServices;
  return { authorizationServices, message, services };
};

const controlRequest = (
  operation: string,
  body: unknown = {},
  init: RequestInit = {}
) =>
  new Request(`https://app.example.test/api/control/${operation}`, {
    ...init,
    body: init.body ?? JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
      ...Object.fromEntries(new Headers(init.headers)),
    },
    method: init.method ?? "POST",
  });

describe("management HTTP reads", () => {
  test("returns the complete enriched read through the shared boundary with an explicit canonical source", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime(fixture);
    const request = controlRequest("mail.read_thread", {
      mailboxId: "mailbox-a",
      organizationId: "team-a",
      threadId: "thread-a",
    });
    const response = await handleControlHttpRequest(request, { runtime });
    expect(response.status).toBe(200);
    const body = controlContracts["mail.read_thread"].output.parse(
      await response.json()
    );
    expect(body.messages).toMatchObject([
      {
        ...fixture.message,
        source: {
          mailboxId: "mailbox-a",
          messageId: fixture.message.id,
          threadId: fixture.message.threadId,
        },
      },
    ]);
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/u);
    const invocation =
      fixture.services["mail.read_thread"].mock.calls.at(-1)?.[0];
    expect(invocation?.context.signal).toBe(request.signal);
    expect(invocation?.parameters).toMatchObject({ mailboxId: "mailbox-a" });
  });

  test("preserves paging inputs and returns the same public enrichment while rechecking the mailbox on each page", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime(fixture);
    const parameters = {
      category: "inbox",
      mailboxId: "mailbox-a",
      organizationId: "team-a",
      pageToken: "opaque-page",
      query: "subject:notes",
    };
    const response = await handleControlHttpRequest(
      controlRequest("mail.search", parameters),
      { runtime }
    );
    const body = controlContracts["mail.search"].output.parse(
      await response.json()
    );
    expect(body.messages[0]).toMatchObject(fixture.message);
    expect(body.nextPageToken).toBeTruthy();
    expect(fixture.services["mail.search"]).toHaveBeenCalledWith(
      expect.objectContaining({ parameters })
    );
    vi.mocked(fixture.authorizationServices.getMailboxAccess).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    const denied = await handleControlHttpRequest(
      controlRequest("mail.search", {
        ...parameters,
        pageToken: body.nextPageToken,
      }),
      { runtime }
    );
    expect(denied.status).toBe(404);
  });

  test("never upgrades API credentials through an existing cookie or reaches a mailbox service", async () => {
    const fixture = createFixture();
    const response = await handleControlHttpRequest(
      controlRequest(
        "mail.read_thread",
        {
          mailboxId: "mailbox-a",
          organizationId: "team-a",
          threadId: "thread-a",
        },
        {
          headers: {
            authorization: "Bearer sending-or-unverified-key",
            cookie: "session=present",
          },
        }
      ),
      { runtime: createControlReadRuntime(fixture) }
    );
    expect(response.status).toBe(401);
    expect(fixture.services["mail.read_thread"]).not.toHaveBeenCalled();
    expect(fixture.authorizationServices.getSession).not.toHaveBeenCalled();
  });

  test("denies a different organization and rejects client-selected identities", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime(fixture);
    const parameters = {
      mailboxId: "mailbox-a",
      organizationId: "another-team",
      threadId: "thread-a",
    };
    const wrongTeam = await handleControlHttpRequest(
      controlRequest("mail.read_thread", parameters),
      { runtime }
    );
    expect(wrongTeam.status).toBe(404);
    const claimedActor = await handleControlHttpRequest(
      controlRequest("mail.read_thread", {
        ...parameters,
        organizationId: "team-a",
        userId: "another-user",
      }),
      { runtime }
    );
    expect(claimedActor.status).toBe(400);
    expect(fixture.services["mail.read_thread"]).not.toHaveBeenCalled();
  });

  test("narrows discovery and OpenAPI to implemented scope and rechecks a grant revoked after discovery", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime({
      ...fixture,
      policy: {
        operations: ["mail.read_thread", "mail.set_read"],
        scopes: ["mail:read", "mail:write"],
      },
    });
    const response = await handleControlHttpRequest(
      controlRequest("capabilities", mailboxTarget),
      { runtime }
    );
    const discovered = controlDiscoveryOutputSchema.parse(
      await response.json()
    );
    expect(discovered.operations.map((operation) => operation.id)).toContain(
      "mail.read_thread"
    );
    expect(
      discovered.operations.map((operation) => operation.id)
    ).not.toContain("mail.set_read");
    const openapi = await handleControlHttpRequest(
      new Request("https://app.example.test/api/control/openapi", {
        headers: { [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION },
      }),
      { runtime }
    );
    const document = await openapi.text();
    expect(document).toContain("/api/control/mail.read_thread");
    expect(document).not.toContain("/api/control/mail.set_read");
    vi.mocked(fixture.authorizationServices.getMailboxAccess).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    const denied = await handleControlHttpRequest(
      controlRequest("mail.read_thread", {
        mailboxId: "mailbox-a",
        organizationId: "team-a",
        threadId: "thread-a",
      }),
      { runtime }
    );
    expect(denied.status).toBe(404);
  });

  test("does not let a client scope claim or a registered mutation bypass the server's read-only policy", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime({
      ...fixture,
      policy: { operations: ["mail.read_thread", "mail.set_read"], scopes: [] },
    });
    const denied = await handleControlHttpRequest(
      controlRequest(
        "mail.read_thread",
        {
          mailboxId: "mailbox-a",
          organizationId: "team-a",
          threadId: "thread-a",
        },
        { headers: { "quieter-control-scopes": "mail:read mail:write" } }
      ),
      { runtime }
    );
    expect(denied.status).toBe(403);
    for (const operation of ["mail.set_read", "unknown-operation"]) {
      const response = await handleControlHttpRequest(
        controlRequest(operation, {
          approvalId: "claimed-approval",
          confirmed: true,
        }),
        { runtime }
      );
      expect(response.status).toBe(404);
      expect(controlErrorSchema.parse(await response.json()).error.code).toBe(
        "UNSUPPORTED_OPERATION"
      );
    }
    expect(fixture.services["mail.read_thread"]).not.toHaveBeenCalled();
  });

  test("rejects malformed, oversized and non-JSON bodies without calling application reads", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime(fixture);
    const malformed = await handleControlHttpRequest(
      controlRequest("mailboxes.list", {}, { body: "{" }),
      { runtime }
    );
    expect(malformed.status).toBe(400);
    const wrongType = await handleControlHttpRequest(
      controlRequest(
        "mailboxes.list",
        {},
        { headers: { "content-type": "text/plain" } }
      ),
      { runtime }
    );
    expect(wrongType.status).toBe(415);
    const oversized = await handleControlHttpRequest(
      controlRequest(
        "mailboxes.list",
        {},
        { body: JSON.stringify({ padding: "x".repeat(100_000) }) }
      ),
      { runtime }
    );
    expect(oversized.status).toBe(413);
    expect(fixture.services["mailboxes.list"]).not.toHaveBeenCalled();
  });

  test("sanitizes unexpected failures and permits a successful retry", async () => {
    const fixture = createFixture();
    const reportError = vi.fn<(error: Error) => void>();
    fixture.services["mail.read_thread"].mockRejectedValueOnce(
      new Error("private address and message content")
    );
    const runtime = createControlReadRuntime(fixture);
    const parameters = {
      mailboxId: "mailbox-a",
      organizationId: "team-a",
      threadId: "thread-a",
    };
    const failed = await handleControlHttpRequest(
      controlRequest("mail.read_thread", parameters),
      { reportError, runtime }
    );
    expect(failed.status).toBe(500);
    await expect(failed.text()).resolves.not.toMatch(
      /private address|message content/u
    );
    expect(reportError.mock.calls[0]?.[0].message).not.toMatch(
      /private address|message content/u
    );
    const retry = await handleControlHttpRequest(
      controlRequest("mail.read_thread", parameters),
      { reportError, runtime }
    );
    expect(retry.status).toBe(200);
  });

  test("returns cancellation without reporting an expected aborted request", async () => {
    const fixture = createFixture();
    const reportError = vi.fn<(error: Error) => void>();
    const controller = new AbortController();
    fixture.services["mail.read_thread"].mockImplementationOnce(
      async ({ context }) => {
        await Promise.resolve();
        controller.abort();
        context.signal?.throwIfAborted();
        return { messages: [], threadId: "thread-a" };
      }
    );
    const response = await handleControlHttpRequest(
      controlRequest(
        "mail.read_thread",
        {
          mailboxId: "mailbox-a",
          organizationId: "team-a",
          threadId: "thread-a",
        },
        { signal: controller.signal }
      ),
      { reportError, runtime: createControlReadRuntime(fixture) }
    );
    expect(response.status).toBe(499);
    expect(reportError).not.toHaveBeenCalled();
  });

  test("keeps calendar throttling and mailbox scope repair as safe expected recovery outcomes", async () => {
    const fixture = createFixture();
    const reportError = vi.fn<(error: Error) => void>();
    const runtime = createControlReadRuntime(fixture);
    const parameters = {
      mailboxId: "mailbox-a",
      organizationId: "team-a",
      threadId: "thread-a",
    };
    fixture.services["mail.read_thread"].mockImplementationOnce(
      async ({ context }) => {
        await Promise.resolve();
        context.responseHeaders?.set("retry-after", "2");
        throw new ORPCError("TOO_MANY_REQUESTS", { status: 429 });
      }
    );
    const limited = await handleControlHttpRequest(
      controlRequest("mail.read_thread", parameters),
      { reportError, runtime }
    );
    expect(limited.status).toBe(429);
    const limitedBody = controlErrorSchema.parse(await limited.json());
    expect(limitedBody.error).toMatchObject({ code: "RATE_LIMITED" });
    expect(limitedBody.error.retryAfterMs).toBeGreaterThan(0);
    fixture.services["mail.read_thread"].mockRejectedValueOnce(
      new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
        data: {
          emailAddress: "private@example.test",
          mailboxId: "private-mailbox",
        },
        status: 409,
      })
    );
    const repair = await handleControlHttpRequest(
      controlRequest("mail.read_thread", parameters),
      { reportError, runtime }
    );
    expect(repair.status).toBe(409);
    const text = await repair.text();
    expect(text).not.toMatch(/private@example|private-mailbox/u);
    expect(reportError).not.toHaveBeenCalled();
  });

  test("checks the selected calendar account and preserves unavailable-account recovery errors", async () => {
    const fixture = createFixture();
    const runtime = createControlReadRuntime(fixture);
    const parameters = {
      calendarId: "calendar-a",
      connectionId: "account-a",
      end: "2026-11-17T10:00:00Z",
      start: "2026-11-16T10:00:00Z",
      timeZone: "Europe/Berlin",
    };
    const response = await handleControlHttpRequest(
      controlRequest("calendar.events", parameters),
      { runtime }
    );
    expect(response.status).toBe(200);
    expect(
      fixture.authorizationServices.assertCalendarAccess
    ).toHaveBeenCalledWith({ connectionId: "account-a", userId: "user-a" });
    vi.mocked(
      fixture.authorizationServices.assertCalendarAccess
    ).mockRejectedValue(
      new ORPCError("REAUTHENTICATION_REQUIRED", { status: 401 })
    );
    const denied = await handleControlHttpRequest(
      controlRequest("calendar.events", parameters),
      { runtime }
    );
    expect(controlErrorSchema.parse(await denied.json()).error.code).toBe(
      "REAUTHENTICATION_REQUIRED"
    );
  });
});
