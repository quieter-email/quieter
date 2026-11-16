import { ORPCError } from "@orpc/server";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { describe, expect, test, vi } from "vite-plus/test";

import { createControlAuthorizer } from "../src/control/authority";
import type { ControlAuthorizationServices } from "../src/control/authority";
import { controlTargetSchema } from "../src/control/registry";

const createServices = () => ({
  assertCalendarAccess: vi
    .fn<ControlAuthorizationServices["assertCalendarAccess"]>()
    .mockResolvedValue(),
  assertOrganizationAccess: vi
    .fn<ControlAuthorizationServices["assertOrganizationAccess"]>()
    .mockResolvedValue(),
  getMailboxAccess: vi
    .fn<ControlAuthorizationServices["getMailboxAccess"]>()
    .mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      organizationId: "team-a",
    }),
  getSession: vi
    .fn<ControlAuthorizationServices["getSession"]>()
    .mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      sessionId: "session-a",
      userId: "user-a",
    }),
});

const mailboxTarget = {
  kind: "mailbox",
  mailboxId: "mailbox-a",
  organizationId: "team-a",
} as const;

describe("management authority", () => {
  test.each([
    new Headers({ authorization: "Bearer transactional-test-key" }),
    new Headers({
      authorization: "Bearer delegated-test-key",
      cookie: "session=present",
    }),
    new Headers({ "x-api-key": "transactional-test-key" }),
    new Headers({ "api-key": "transactional-test-key" }),
  ])(
    "never substitutes a sending or unverified delegated key for management authentication",
    async (headers) => {
      const services = createServices();
      const control = createControlAuthorizer(
        { operations: ["mail.read_thread"], scopes: ["mail:read"] },
        services
      );
      await expect(
        control.authorize({
          headers: new Headers(headers),
          operation: "mail.read_thread",
          target: mailboxTarget,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(services.getSession).not.toHaveBeenCalled();
      expect(services.getMailboxAccess).not.toHaveBeenCalled();
    }
  );

  test("requires a live session for discovery and execution", async () => {
    const services = createServices();
    const control = createControlAuthorizer(
      { operations: ["mail.read_thread"], scopes: ["mail:read"] },
      services
    );
    services.getSession.mockResolvedValueOnce(null);
    await expect(
      control.discover({ headers: new Headers(), target: mailboxTarget })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    services.getSession.mockResolvedValueOnce({
      expiresAt: new Date(0),
      sessionId: "expired-session",
      userId: "user-a",
    });
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target: mailboxTarget,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("binds access to the authenticated user, requested mailbox and its current organization", async () => {
    const services = createServices();
    const control = createControlAuthorizer(
      { operations: ["mail.read_thread"], scopes: ["mail:read"] },
      services
    );
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target: mailboxTarget,
      })
    ).resolves.toMatchObject({ target: mailboxTarget, userId: "user-a" });
    expect(services.getMailboxAccess).toHaveBeenCalledWith({
      mailboxId: "mailbox-a",
      userId: "user-a",
    });
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target: { ...mailboxTarget, organizationId: "another-team" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("does not let request headers widen server-configured scopes or adapter coverage", async () => {
    const services = createServices();
    const input = {
      headers: new Headers({
        "quieter-control-scopes": "mail:read mail:write",
      }),
      operation: "mail.read_thread" as const,
      target: mailboxTarget,
    };
    const missingScope = createControlAuthorizer(
      { operations: ["mail.read_thread"], scopes: [] },
      services
    );
    const missingAdapter = createControlAuthorizer(
      { operations: [], scopes: ["mail:read"] },
      services
    );
    await expect(missingScope.authorize(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(missingAdapter.authorize(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      missingAdapter.discover({ headers: new Headers(), target: mailboxTarget })
    ).resolves.toHaveLength(0);
    expect(services.getMailboxAccess).not.toHaveBeenCalled();
  });

  test("rechecks revoked grants after discovery without trusting its earlier result", async () => {
    const services = createServices();
    const control = createControlAuthorizer(
      { operations: ["mail.read_thread"], scopes: ["mail:read"] },
      services
    );
    await expect(
      control.discover({ headers: new Headers(), target: mailboxTarget })
    ).resolves.toMatchObject([{ id: "mail.read_thread" }]);
    services.getMailboxAccess.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target: mailboxTarget,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      control.discover({ headers: new Headers(), target: mailboxTarget })
    ).resolves.toHaveLength(0);
  });

  test("derives read versus write capability from the current managed-mail grant", async () => {
    const services = createServices();
    services.getMailboxAccess.mockResolvedValue({
      capabilities: getMailboxCapabilities({
        provider: "managed",
        role: "reader",
      }),
      organizationId: "team-a",
    });
    const control = createControlAuthorizer(
      {
        operations: ["mail.read_thread", "mail.set_read"],
        scopes: ["mail:read", "mail:write"],
      },
      services
    );
    const visible = await control.discover({
      headers: new Headers(),
      target: mailboxTarget,
    });
    expect(visible.map((operation) => operation.id)).toContain(
      "mail.read_thread"
    );
    expect(visible.map((operation) => operation.id)).not.toContain(
      "mail.set_read"
    );
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.set_read",
        target: mailboxTarget,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("does not turn an organization or mailbox grant into another user's calendar access", async () => {
    const services = createServices();
    const control = createControlAuthorizer(
      {
        operations: ["calendar.events", "organization.read"],
        scopes: ["calendar:read", "organization:read"],
      },
      services
    );
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "calendar.events",
        target: mailboxTarget,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    services.assertCalendarAccess.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "calendar.events",
        target: { connectionId: "another-users-account", kind: "calendar" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(services.assertCalendarAccess).toHaveBeenCalledWith({
      connectionId: "another-users-account",
      userId: "user-a",
    });
    expect(services.assertOrganizationAccess).not.toHaveBeenCalled();
  });

  test("requires current organization management authority for settings changes", async () => {
    const services = createServices();
    const control = createControlAuthorizer(
      {
        operations: ["organization.settings.update"],
        scopes: ["organization:write"],
      },
      services
    );
    services.assertOrganizationAccess.mockRejectedValue(
      new ORPCError("FORBIDDEN")
    );
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "organization.settings.update",
        target: { kind: "organization", organizationId: "team-a" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(services.assertOrganizationAccess).toHaveBeenCalledWith({
      manage: true,
      organizationId: "team-a",
      userId: "user-a",
    });
  });

  test("rejects caller-selected users and propagates unexpected authorization failures", async () => {
    const services = createServices();
    const control = createControlAuthorizer(
      { operations: ["mail.read_thread"], scopes: ["mail:read"] },
      services
    );
    expect(
      controlTargetSchema.safeParse({ kind: "user", userId: "another-user" })
        .success
    ).toBeFalsy();
    services.getMailboxAccess.mockRejectedValue(
      new Error("access service unavailable")
    );
    await expect(
      control.discover({ headers: new Headers(), target: mailboxTarget })
    ).rejects.toThrow(/access service unavailable/u);
  });
});
