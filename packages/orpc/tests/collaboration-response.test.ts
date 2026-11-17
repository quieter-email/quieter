import { ORPCError } from "@orpc/server";
import type { getSessionWithOrganization } from "@quieter/auth/session";
import { db } from "@quieter/database/client";
import type {
  CollaborationChanges,
  CollaborationState,
} from "@quieter/mail/collaboration";
import type {
  CollaborationMentionsPage,
  CollaborationNoteParticipants,
  CollaborationNoteResult,
  CollaborationNotesPage,
} from "@quieter/mail/collaboration-notes";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createOrpcHandler } from "../src/server";

const fixtures = vi.hoisted(() => ({
  acknowledge: vi.fn<() => Promise<{ acknowledged: boolean }>>(),
  changes: vi.fn<() => Promise<CollaborationChanges>>(),
  get: vi.fn<() => Promise<CollaborationState>>(),
  mentions: vi.fn<() => Promise<CollaborationMentionsPage>>(),
  mutate: vi.fn<() => Promise<CollaborationNoteResult>>(),
  note: vi.fn<() => Promise<CollaborationNoteResult>>(),
  notes: vi.fn<() => Promise<CollaborationNotesPage>>(),
  participants: vi.fn<() => Promise<CollaborationNoteParticipants>>(),
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

vi.mock(import("../src/mailbox/collaboration/notes"), () => ({
  acknowledgeCollaborationMention: fixtures.acknowledge,
  getCollaborationNote: fixtures.note,
  listCollaborationMentions: fixtures.mentions,
  listCollaborationNoteParticipants: fixtures.participants,
  listCollaborationNotes: fixtures.notes,
  mutateCollaborationNote: fixtures.mutate,
}));

const scope = { mailboxId: "shared-mailbox", threadId: "shared-thread" };
const identity = {
  ...scope,
  contextId: "ee588d0c-777d-4d55-b633-a1b61508714a",
  noteId: "b2529670-108d-4193-8fc1-3d4d0cb2fbad",
};

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
    fixtures.acknowledge.mockReset().mockResolvedValue({ acknowledged: true });
    fixtures.mentions
      .mockReset()
      .mockResolvedValue({ mentions: [], next: null });
    fixtures.note.mockReset().mockResolvedValue({ note: null, snapshot });
    fixtures.notes
      .mockReset()
      .mockResolvedValue({ next: null, notes: [], snapshot });
    fixtures.participants
      .mockReset()
      .mockResolvedValue({ nextMemberId: null, participants: [], snapshot });
    fixtures.mutate.mockReset().mockResolvedValue({ note: null, snapshot });
    fixtures.get.mockReset().mockResolvedValue(snapshot);
    fixtures.prepare.mockReset().mockResolvedValue(snapshot);
    fixtures.changes.mockReset().mockResolvedValue({
      changed: true,
      reset: false,
      snapshot,
    });
  });

  test.each([
    { input: scope, method: "GET", route: "get", status: 200 },
    { input: scope, method: "GET", route: "changes", status: 200 },
    { input: scope, method: "POST", route: "prepare", status: 200 },
    { input: scope, method: "GET", route: "get", status: 404 },
    { input: scope, method: "GET", route: "notes/list", status: 200 },
    { input: identity, method: "GET", route: "notes/get", status: 200 },
    { input: scope, method: "GET", route: "notes/participants", status: 200 },
    {
      input: { mailboxId: scope.mailboxId },
      method: "GET",
      route: "mentions/list",
      status: 200,
    },
    {
      input: identity,
      method: "POST",
      route: "mentions/acknowledge",
      status: 200,
    },
    {
      input: {
        ...scope,
        body: "Internal note",
        expected: { contextId: identity.contextId, revision: "1" },
        kind: "create",
        mentionMemberIds: [],
        noteId: identity.noteId,
      },
      method: "POST",
      route: "notes/mutate",
      status: 200,
    },
  ])(
    "$method $route keeps $status responses private",
    async ({ input, method, route, status }) => {
      if (status === 404) {
        fixtures.get.mockRejectedValue(new ORPCError("NOT_FOUND"));
      }
      const payload = JSON.stringify({
        json: input,
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
