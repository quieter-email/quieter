import { SESv2Client } from "@aws-sdk/client-sesv2";
import { ORPCError } from "@orpc/server";
import type { reserveOrganizationMailSend } from "@quieter/billing/mail-send-reservation";
import { organizationMailSendIdempotency } from "@quieter/database/schema";
import { getTableColumns } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { assertMailEffectAllowed } from "../src/gmail-request";
import type { assertAgentMailboxAccess } from "../src/mail-agent/access";
import { sendPreparedMail } from "../src/mail-send";
import type { assertOrganizationOwnsVerifiedSenderDomain } from "../src/organization-mail-policy";

const fixture = vi.hoisted(() => ({
  access: vi.fn<typeof assertAgentMailboxAccess>(),
  provider: vi.fn<() => Promise<{ MessageId: string }>>(),
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  reserve: vi.fn<typeof reserveOrganizationMailSend>(),
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      AWS_REGION: "us-east-1",
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy executes actual query builders while replacing only database I/O.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  Object.defineProperty(database, "transaction", {
    value: async <T>(run: (transaction: typeof database) => Promise<T>) =>
      await run(database),
  });
  return { db: database };
});
vi.mock(import("@quieter/billing/mail-send-reservation"), () => ({
  reserveOrganizationMailSend: fixture.reserve,
}));
vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: fixture.access,
}));
vi.mock(import("../src/organization-mail-policy"), async (importOriginal) => ({
  ...(await importOriginal()),
  assertOrganizationOwnsVerifiedSenderDomain:
    vi.fn<typeof assertOrganizationOwnsVerifiedSenderDomain>(),
}));
vi.mock(import("../src/organization-mail-delivery"), () => ({
  assertOrganizationMailRecipientsNotSuppressed: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("../src/managed-mail/messages/raw-object"), () => ({
  readRawMailObject: async () =>
    await Promise.resolve(
      new TextEncoder().encode(
        "From: sender@example.test\r\nTo: person@example.test\r\nSubject: Message\r\n\r\nHello"
      )
    ),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<() => void>(),
}));

let operation: typeof organizationMailSendIdempotency.$inferSelect;
let readOnly = false;
let version = 0;

describe("managed send final authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
      // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return -- The SDK also declares a callback overload; this test replaces its promise transport.
      fixture.provider
    );
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "production");
    vi.stubEnv("AWS_REGION", "us-east-1");
    readOnly = false;
    version = 0;
    operation = {
      attemptedAt: null,
      billingUserId: "owner",
      createdAt: new Date(),
      estimatedCostMicroCents: 1,
      failureMessage: null,
      id: "18cba911-a53c-4555-a8bd-c03394db8335",
      idempotencyKey: "permanent-operation",
      messageHeaderId: "<send@example.test>",
      organizationId: "org",
      rawObjectBucket: "fixture",
      rawObjectKey: "message",
      rawObjectProvider: "r2",
      requestHash: "content-hash",
      response: null,
      snapshot: {
        actorUserId: "owner",
        attachments: [],
        bcc: [],
        bodyText: "Hello",
        cc: [],
        headers: [],
        kind: "mailbox",
        mailboxId: "mailbox",
        rawSizeBytes: 1,
        replyTo: [],
        sender: "sender@example.test",
        sentAt: new Date().toISOString(),
        subject: "Message",
        tags: [],
        to: ["person@example.test"],
      },
      status: "prepared",
      updatedAt: new Date(),
    };
    fixture.access.mockResolvedValue({
      canSaveDraft: true,
      memberId: "member",
      organizationId: "org",
      provider: "managed",
      shared: false,
    });
    fixture.reserve.mockImplementation(
      async () => await Promise.resolve(operation)
    );
    fixture.query.mockImplementation(async (query, parameters) => {
      await Promise.resolve();
      if (query.includes('from "mailboxAiAuthority"')) {
        return { rows: [[false, readOnly, version]] };
      }
      if (query.includes('from "mailbox"')) {
        return {
          rows: query.includes('"provider"')
            ? [["managed", "connected"]]
            : [["mailbox"]],
        };
      }
      if (query.includes('from "organization"')) {
        return { rows: [["org"]] };
      }
      if (query.startsWith('update "organizationMailSendIdempotency"')) {
        const assignments = query.split(" where ")[0] ?? "";
        for (const match of assignments.matchAll(
          /"(?<column>\w+)" = \$(?<position>\d+)/gu
        )) {
          if (match.groups !== undefined) {
            Reflect.set(
              operation,
              match.groups.column,
              parameters[Number(match.groups.position) - 1]
            );
          }
        }
        if (operation.status === "submitting") {
          readOnly = true;
          version += 1;
        }
      }
      const returning =
        query.startsWith("select") || query.includes(" returning ");
      return {
        rows: returning
          ? [
              Object.keys(getTableColumns(organizationMailSendIdempotency)).map(
                (key) =>
                  Object.entries(operation).find(([name]) => name === key)?.[1]
              ),
            ]
          : [],
      };
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("rejects a policy change after reservation and submission claim without dispatching or making the receipt uncertain", async () => {
    if (operation.snapshot === null || operation.messageHeaderId === null) {
      throw new Error("Missing captured send fixture");
    }
    await expect(
      sendPreparedMail({
        beforeEffect: async () => {
          await assertMailEffectAllowed(
            {
              origin: {
                kind: "ai",
                mailboxId: "mailbox",
                mode: "interactive",
                policyVersion: 0,
                userId: "owner",
              },
              privateContext: false,
              userId: "owner",
            },
            "mailbox"
          );
        },
        id: operation.id,
        idempotencyKey: operation.idempotencyKey,
        messageHeaderId: operation.messageHeaderId,
        organizationId: "org",
        raw: "captured message",
        requestHash: operation.requestHash,
        snapshot: operation.snapshot,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { sendNotStarted: true },
    });
    expect(fixture.provider).not.toHaveBeenCalled();
    expect(operation.status).toBe("prepared");
    expect(operation.attemptedAt).toBeNull();
    expect(operation.idempotencyKey).toBe("permanent-operation");
  });

  test("does not refresh an existing send's AI operation stamp on retry", async () => {
    if (operation.snapshot === null || operation.messageHeaderId === null) {
      throw new Error("Missing captured send fixture");
    }
    const origin = {
      kind: "ai",
      mailboxId: "mailbox",
      mode: "interactive",
      policyVersion: 3,
      userId: "owner",
    } as const;
    operation.snapshot.origin = { learning: null, operation: origin };
    await expect(
      sendPreparedMail({
        id: operation.id,
        idempotencyKey: operation.idempotencyKey,
        messageHeaderId: operation.messageHeaderId,
        organizationId: operation.organizationId,
        raw: "captured message",
        requestHash: operation.requestHash,
        snapshot: {
          ...operation.snapshot,
          origin: {
            learning: null,
            operation: { ...origin, policyVersion: 4 },
          },
        },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      data: { sendNotStarted: true },
    });
    expect(operation.snapshot.origin).toMatchObject({ operation: origin });
    expect(fixture.provider).not.toHaveBeenCalled();
    expect(operation.status).toBe("prepared");
  });

  test("preserves the original learning epoch when a human send reservation is retried", async () => {
    if (operation.snapshot === null || operation.messageHeaderId === null) {
      throw new Error("Missing captured send fixture");
    }
    const learning = {
      kind: "ai",
      mailboxId: "mailbox",
      mode: "automation",
      policyVersion: 3,
      userId: "owner",
    } as const;
    operation.snapshot.origin = { learning, operation: { kind: "human" } };
    fixture.reserve.mockImplementation(async (input) => {
      await Promise.resolve();
      operation.snapshot = input.snapshot;
      return operation;
    });
    await expect(
      sendPreparedMail({
        beforeEffect: async () => {
          await Promise.resolve();
          if (operation.status === "submitting") {
            throw new ORPCError("FORBIDDEN", {
              data: { sendNotStarted: true },
            });
          }
        },
        id: operation.id,
        idempotencyKey: operation.idempotencyKey,
        messageHeaderId: operation.messageHeaderId,
        organizationId: operation.organizationId,
        raw: "captured message",
        requestHash: operation.requestHash,
        snapshot: {
          ...operation.snapshot,
          origin: {
            learning: { ...learning, policyVersion: 9 },
            operation: { kind: "human" },
          },
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(operation.snapshot?.origin).toMatchObject({ learning });
    expect(fixture.provider).not.toHaveBeenCalled();
    expect(operation.status).toBe("prepared");
  });
});
