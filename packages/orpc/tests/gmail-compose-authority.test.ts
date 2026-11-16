import { ORPCError } from "@orpc/server";
import { gmailComposeOperation } from "@quieter/database/schema";
import { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { getTableColumns } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { sendGmailMessage } from "../src/gmail-compose";
import { saveGmailLabelDetails } from "../src/gmail-labels";
import { REQUIRED_GMAIL_SCOPES } from "../src/gmail-mailbox-access";
import type {
  PreparedGmailMailboxIdentity,
  runAuthorizedGmailMailbox,
} from "../src/gmail-mailbox-access";
import { assertMailEffectAllowed, callGmail } from "../src/gmail-request";
import type { assertAgentMailboxAccess } from "../src/mail-agent/access";
import type { withMailComposeLock } from "../src/mail/compose-lock";

const fixture = vi.hoisted(() => ({
  access: vi.fn<typeof assertAgentMailboxAccess>(),
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy preserves the actual query builders and replaces only database I/O.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  Object.defineProperty(database, "transaction", {
    value: async <T>(run: (transaction: typeof database) => Promise<T>) =>
      await run(database),
  });
  return { db: database };
});
vi.mock(import("../src/gmail-mailbox-access"), async (importOriginal) => ({
  ...(await importOriginal()),
  runAuthorizedGmailMailbox: async <T>(
    _input: Parameters<typeof runAuthorizedGmailMailbox>[0],
    operation: (
      token: string,
      identity: PreparedGmailMailboxIdentity
    ) => Promise<T>
  ) =>
    await operation("token", {
      googleSubject: "subject",
      mailboxId: "mailbox",
    }),
}));
vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: fixture.access,
}));
vi.mock(import("../src/mail/compose-lock"), () => ({
  withMailComposeLock: async <T>(
    ...args: Parameters<typeof withMailComposeLock<T>>
  ) => await args[2](),
}));
vi.mock(import("../src/gmail-open-tracking"), () => ({
  prepareGmailOpenTracking: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<() => void>(),
}));

let operation: typeof gmailComposeOperation.$inferSelect;
let inserted = false;
let readOnly = false;
let version = 0;
let revokeOnClaim = false;
let replaceSubjectOnClaim = false;
let currentGoogleSubject = "subject";
let connectionStatus = "connected";
let credentialScopes = "";
let labelWrites = 0;

describe("Gmail compose final authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("QUIETER_DEPLOYMENT_ENV", "production");
    inserted = false;
    readOnly = false;
    version = 0;
    revokeOnClaim = false;
    replaceSubjectOnClaim = false;
    currentGoogleSubject = "subject";
    connectionStatus = "connected";
    credentialScopes = REQUIRED_GMAIL_SCOPES.join(" ");
    labelWrites = 0;
    operation = {
      createdAt: new Date(),
      draftId: null,
      followUpReminder: null,
      id: "18cba911-a53c-4555-a8bd-c03394db8335",
      kind: "send",
      mailboxId: "mailbox",
      messageHeaderId: "<send@example.test>",
      operationKey: "send:18cba911-a53c-4555-a8bd-c03394db8335",
      requestHash: "",
      response: null,
      status: "prepared",
      updatedAt: new Date(),
    };
    fixture.access.mockResolvedValue({
      canSaveDraft: true,
      memberId: "membership",
      organizationId: "org",
      provider: "gmail",
      shared: false,
    });
    fixture.query.mockImplementation(async (query, parameters) => {
      await Promise.resolve();
      if (query.includes('from "mailboxAiAuthority"')) {
        return { rows: [[false, readOnly, version]] };
      }
      if (query.includes('from "gmailCredential"')) {
        return { rows: [[currentGoogleSubject, credentialScopes]] };
      }
      if (query.includes('from "mailbox"')) {
        return {
          rows: query.includes('"provider"')
            ? [["gmail", connectionStatus]]
            : [["mailbox"]],
        };
      }
      if (query.startsWith('update "gmailLabel"')) {
        labelWrites += 1;
        return { rows: [[null, null, null, "label"]] };
      }
      const insertion =
        /^insert into "gmailComposeOperation" \((?<columns>[^)]+)\) values \((?<values>[^)]+)\)/u.exec(
          query
        );
      if (insertion?.groups !== undefined) {
        const columns = insertion.groups.columns
          .split(", ")
          .map((column) => column.replaceAll('"', ""));
        for (const [index, value] of insertion.groups.values
          .split(", ")
          .entries()) {
          const parameter = /^\$(?<position>\d+)$/u.exec(value);
          const column = columns[index];
          if (parameter?.groups !== undefined && column !== undefined) {
            Reflect.set(
              operation,
              column,
              parameters[Number(parameter.groups.position) - 1]
            );
          }
        }
        inserted = true;
      }
      if (query.startsWith('update "gmailComposeOperation"')) {
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
        if (operation.status === "submitting" && revokeOnClaim) {
          readOnly = true;
          version += 1;
        }
        if (operation.status === "submitting" && replaceSubjectOnClaim) {
          currentGoogleSubject = "replacement-subject";
        }
      }
      const returning =
        query.startsWith("select") || query.includes(" returning ");
      return {
        rows:
          inserted && returning
            ? [
                Object.keys(getTableColumns(gmailComposeOperation)).map(
                  (key) =>
                    Object.entries(operation).find(
                      ([name]) => name === key
                    )?.[1]
                ),
              ]
            : [],
      };
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("allows an offline human to edit local label details without provider token grants", async () => {
    connectionStatus = "disconnected";
    credentialScopes = "";
    await saveGmailLabelDetails({
      context: { userId: "owner" },
      description: "Description",
      inclusionCriteria: null,
      labelId: "label",
      mailboxId: "mailbox",
    });
    expect(labelWrites).toBe(1);
  });

  test("rejects local label metadata from a prepared account after its identity changes", async () => {
    currentGoogleSubject = "replacement";
    connectionStatus = "disconnected";
    credentialScopes = "";
    await expect(
      saveGmailLabelDetails({
        context: {
          gmailIdentity: { googleSubject: "subject", mailboxId: "mailbox" },
          userId: "owner",
        },
        description: "Description",
        inclusionCriteria: null,
        labelId: "label",
        mailboxId: "mailbox",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(labelWrites).toBe(0);
  });

  test.each(["mime", "claim"] as const)(
    "prevents dispatch after authority changes during %s preparation and keeps the same operation retryable",
    async (boundary) => {
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchMock);
      const file = new File(["private attachment"], "notes.txt", {
        type: "text/plain",
      });
      const readFile = file.arrayBuffer.bind(file);
      let reads = 0;
      vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
        const content = await readFile();
        reads += 1;
        if (boundary === "mime" && reads > 1) {
          readOnly = true;
          version += 1;
        }
        return content;
      });
      revokeOnClaim = boundary === "claim";
      const message = composeDraftInputSchema.parse({
        attachments: [
          {
            file,
            id: "attachment",
            isInline: false,
            mimeType: "text/plain",
            name: "notes.txt",
            size: file.size,
          },
        ],
        bodyHtml: "<p>Hello</p>",
        bodyText: "Hello",
        inlineImages: [],
        localId: "local",
        recipients: { bcc: "", cc: "", to: "person@example.test" },
        saveStatus: "idle",
        sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
        subject: "Message",
        updatedAt: Date.now(),
      });
      await expect(
        sendGmailMessage(
          "token",
          "mailbox",
          message,
          undefined,
          undefined,
          "owner",
          async () => {
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
          }
        )
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        data: { sendNotStarted: true },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(operation.status).toBe("prepared");
      expect(operation.operationKey).toContain(message.sendOperationId);
    }
  );

  test("dispatches an authorized public-context AI send with its prepared account identity", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "sent", threadId: "thread" }));
    vi.stubGlobal("fetch", fetchMock);
    const message = composeDraftInputSchema.parse({
      attachments: [],
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      inlineImages: [],
      localId: "local",
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "idle",
      sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
      subject: "Message",
      updatedAt: Date.now(),
    });
    const sent = await callGmail(
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
      "mailbox",
      async (token, signal, beforeEffect) =>
        await sendGmailMessage(
          token,
          "mailbox",
          message,
          signal,
          undefined,
          "owner",
          beforeEffect
        ),
      { kind: "send" }
    );
    expect(sent).toMatchObject({ id: "sent", idempotent: false });
    expect(operation.status).toBe("accepted");
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          (url instanceof Request ? url.url : String(url)).includes(
            "/messages/send"
          ) && options?.method === "POST"
      )
    ).toBeTruthy();
  });

  test("rejects a replaced account identity after preparation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    replaceSubjectOnClaim = true;
    const message = composeDraftInputSchema.parse({
      attachments: [],
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      inlineImages: [],
      localId: "local",
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "idle",
      sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
      subject: "Message",
      updatedAt: Date.now(),
    });
    await expect(
      callGmail(
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
        "mailbox",
        async (token, signal, beforeEffect) =>
          await sendGmailMessage(
            token,
            "mailbox",
            message,
            signal,
            undefined,
            "owner",
            beforeEffect
          ),
        { kind: "send" }
      )
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      data: { sendNotStarted: true },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(operation.status).toBe("prepared");
  });

  test("preserves a known authorization failure without reporting an uncertain delivery", async () => {
    const failure = new ORPCError("FORBIDDEN", {
      data: { sendNotStarted: true },
      message: "Access revoked",
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const message = composeDraftInputSchema.parse({
      attachments: [],
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      inlineImages: [],
      localId: "local",
      recipients: { bcc: "", cc: "", to: "person@example.test" },
      saveStatus: "idle",
      sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
      subject: "Message",
      updatedAt: Date.now(),
    });
    await expect(
      sendGmailMessage(
        "token",
        "mailbox",
        message,
        undefined,
        undefined,
        "owner",
        async () => {
          await Promise.resolve();
          throw failure;
        }
      )
    ).rejects.toBe(failure);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(operation.status).toBe("prepared");
  });
});
