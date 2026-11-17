import { ORPCError } from "@orpc/server";
import type { getSessionWithOrganization } from "@quieter/auth/session";
import type { CalendarAccount } from "@quieter/calendar";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createControlAuthorizer } from "../src/control/authority";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const fixtures = vi.hoisted(() => ({
  calendarAccount:
    vi.fn<
      (input: {
        connectionId: string;
        userId: string;
      }) => Promise<CalendarAccount>
    >(),
  member:
    vi.fn<
      (input: {
        organizationId: string;
        userId: string;
      }) => Promise<{ id: string; role: string }>
    >(),
  parseApiMailbox: vi.fn<(mailboxId: string) => string | null>(),
  persistedMailbox: vi.fn<typeof assertAccessibleMailbox>(),
  session: vi.fn<typeof getSessionWithOrganization>(),
}));

vi.mock(import("@quieter/auth/session"), () => ({
  getSessionWithOrganization: fixtures.session,
}));
vi.mock(import("../src/organization-api-mail"), () => ({
  parseOrganizationApiMailboxId: fixtures.parseApiMailbox,
}));
vi.mock(import("../src/mail-domain/service"), () => ({
  assertUserOrganizationMember: fixtures.member,
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: fixtures.persistedMailbox,
}));
vi.mock(import("../src/calendar/service"), () => ({
  getCalendarAccountForUser: fixtures.calendarAccount,
}));

describe("management default resource authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.session.mockResolvedValue({
      session: {
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        id: "session-a",
        ipAddress: null,
        token: "fixture-session-token",
        updatedAt: new Date(),
        userAgent: null,
        userId: "user-a",
      },
      user: {
        createdAt: new Date(),
        defaultOrganizationProvisioned: true,
        email: "owner@example.test",
        emailVerified: true,
        id: "user-a",
        name: "Owner",
        onboardingCompletedAt: null,
        termsAcceptedAt: null,
        updatedAt: new Date(),
      },
    });
    fixtures.parseApiMailbox.mockReturnValue("team-a");
    fixtures.member.mockResolvedValue({ id: "membership-a", role: "member" });
    fixtures.calendarAccount.mockResolvedValue({
      email: "owner@example.test",
      id: "account-a",
      mailboxId: "mailbox-a",
      name: "Calendar",
      status: "connected",
    });
  });

  test("uses the established API mailbox parser and current membership before granting an organization mail read", async () => {
    const control = createControlAuthorizer({
      operations: ["mail.read_thread"],
      scopes: ["mail:read"],
    });
    const target = {
      kind: "mailbox",
      mailboxId: "synthetic-api-mailbox",
      organizationId: "team-a",
    } as const;
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target,
      })
    ).resolves.toMatchObject({ target, userId: "user-a" });
    expect(fixtures.parseApiMailbox).toHaveBeenCalledWith(target.mailboxId);
    expect(fixtures.member).toHaveBeenCalledWith({
      organizationId: "team-a",
      userId: "user-a",
    });
    expect(fixtures.persistedMailbox).not.toHaveBeenCalled();
    fixtures.member.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("does not turn organization membership into mutation capability or a different organization binding", async () => {
    const control = createControlAuthorizer({
      operations: ["mail.read_thread", "mail.set_read"],
      scopes: ["mail:read", "mail:write"],
    });
    const target = {
      kind: "mailbox",
      mailboxId: "synthetic-api-mailbox",
      organizationId: "team-a",
    } as const;
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.set_read",
        target,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "mail.read_thread",
        target: { ...target, organizationId: "another-team" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("retains owner-account checks and identifies reconnect recovery separately", async () => {
    fixtures.calendarAccount.mockResolvedValueOnce({
      email: "owner@example.test",
      id: "account-a",
      mailboxId: "mailbox-a",
      name: "Calendar",
      status: "needs-reconnect",
    });
    const control = createControlAuthorizer({
      operations: ["calendar.events"],
      scopes: ["calendar:read"],
    });
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "calendar.events",
        target: { connectionId: "account-a", kind: "calendar" },
      })
    ).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED", status: 401 });
    expect(fixtures.calendarAccount).toHaveBeenCalledWith({
      connectionId: "account-a",
      userId: "user-a",
    });
    fixtures.calendarAccount.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      control.authorize({
        headers: new Headers(),
        operation: "calendar.events",
        target: { connectionId: "other-user-account", kind: "calendar" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
