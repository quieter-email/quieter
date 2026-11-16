import { ORPCError } from "@orpc/server";
import type { getSessionWithOrganization } from "@quieter/auth/session";
import { db } from "@quieter/database/client";
import type {
  CollaborationChanges,
  CollaborationState,
} from "@quieter/mail/collaboration";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createOrpcHandler } from "../src/server";

const fixtures = vi.hoisted(() => ({
  changes: vi.fn<() => Promise<CollaborationChanges>>(),
  get: vi.fn<() => Promise<CollaborationState>>(),
  prepare: vi.fn<() => Promise<CollaborationState>>(),
}));

vi.mock(import("@quieter/auth/session"), async (original) => {
  const createdAt = new Date("2026-11-16T00:00:00Z");
  return {
    ...(await original()),
    getSessionWithOrganization: vi
      .fn<typeof getSessionWithOrganization>()
      .mockResolvedValue({
        session: {
          createdAt,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          id: "synthetic-session",
          token: "synthetic-session-token",
          updatedAt: createdAt,
          userId: "synthetic-teammate",
        },
        user: {
          createdAt,
          email: "teammate@example.test",
          emailVerified: true,
          id: "synthetic-teammate",
          name: "Synthetic teammate",
          updatedAt: createdAt,
        },
      }),
  };
});

vi.mock(import("../src/mailbox/collaboration/service"), () => ({
  getCollaboration: fixtures.get,
  getCollaborationChanges: fixtures.changes,
  prepareCollaboration: fixtures.prepare,
}));

describe("collaboration HTTP response privacy", () => {
  beforeEach(() => {
    const snapshot = {
      href: "/?mailboxId=shared-mailbox&threadId=shared-thread",
      mailboxId: "shared-mailbox",
      permissions: {
        assignOthers: false,
        claimSelf: true,
        moderateNotes: false,
        read: true,
        writeOwnNotes: true,
      },
      role: "responder",
      state: { kind: "unprepared" },
      threadId: "shared-thread",
    } satisfies CollaborationState;
    fixtures.get.mockReset().mockResolvedValue(snapshot);
    fixtures.prepare.mockReset().mockResolvedValue(snapshot);
    fixtures.changes.mockReset().mockResolvedValue({
      changed: true,
      reset: false,
      snapshot,
    });
  });

  test.each([
    { method: "GET", route: "get", status: 200 },
    { method: "GET", route: "changes", status: 200 },
    { method: "POST", route: "prepare", status: 200 },
    { method: "GET", route: "get", status: 404 },
  ])(
    "$method $route keeps $status responses private",
    async ({ method, route, status }) => {
      if (status === 404) {
        fixtures.get.mockRejectedValue(new ORPCError("NOT_FOUND"));
      }
      const payload = JSON.stringify({
        json: { mailboxId: "shared-mailbox", threadId: "shared-thread" },
      });
      const url = new URL(
        `https://example.test/api/orpc/collaboration/${route}`
      );
      if (method === "GET") {
        url.searchParams.set("data", payload);
      }
      const request =
        method === "POST"
          ? new Request(url, {
              body: payload,
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          : new Request(url, { method: "GET" });
      const result = await createOrpcHandler({
        reportError: vi.fn<(error: unknown) => void>(),
      }).handle(request, {
        context: { db, headers: new Headers() },
        prefix: "/api/orpc",
      });
      expect(result.matched).toBeTruthy();
      expect(result.response?.status).toBe(status);
      const directives = result.response?.headers
        .get("cache-control")
        ?.split(",")
        .map((directive) => directive.trim());
      expect(directives).toContain("private");
      expect(directives).toContain("no-store");
    }
  );
});
