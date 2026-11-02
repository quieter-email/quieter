import { ORPCError } from "@orpc/server";
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import { describe, expect, test, vi } from "vite-plus/test";

import type { assertAgentMailboxAccess } from "../src/mail-agent/access";
import {
  compileAgentManifest,
  resolveMentionedConnectionIds,
} from "../src/mail-agent/catalog";
import type { AgentCatalogTool } from "../src/mail-agent/catalog";
import { mailAgentInputs } from "../src/mail-agent/contracts";
import {
  activateMailAgent,
  enqueueManualMailAgentRun,
  getAgentRevisionView,
  getMailAgentSettings,
  getMailAgentThreadResults,
  pauseMailAgent,
  reviewMailAgent,
} from "../src/mail-agent/service";

const access = vi.hoisted(() => vi.fn<typeof assertAgentMailboxAccess>());
vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: access,
}));

const mailRead: AgentCatalogTool = {
  accountLabel: null,
  connectionId: null,
  description: "Read thread",
  inputSchema: { properties: {}, type: "object" },
  label: "Read thread",
  operation: "read",
  provider: null,
  providerToolName: null,
  scope: "mailbox",
  toolId: "mail.read_thread",
};
const linearWrite: AgentCatalogTool = {
  accountLabel: "Team",
  connectionId: "account-exact",
  description: "Save issue",
  inputSchema: { properties: { title: { type: "string" } }, type: "object" },
  label: "Save issue",
  operation: "write",
  provider: "linear",
  providerToolName: "save_issue",
  scope: "connector",
  toolId: "linear.save_issue",
};
const specification = () =>
  actionSpecificationSchema.parse({
    connectors: [{ connectionId: "account-exact", referenceId: "selected" }],
    eligibility: {
      bodyIncludes: [],
      sender: { addresses: ["sender@example.test"], kind: "addresses" },
      subjectIncludes: [],
    },
    instructions: "Save a task when a customer requests one.",
    mailboxId: "mailbox",
    permissions: [
      { id: "mail-read", operation: "read", scope: "mailbox" },
      {
        connectorReferenceId: "selected",
        id: "tasks-write",
        operation: "write",
        scope: "connector",
      },
    ],
    review: {
      assumptions: [],
      questions: [],
      summary: "Create requested tasks.",
    },
    sourceText: "Create tasks in @[connection:account-exact] when requested.",
    toolGrants: [
      {
        confirmation: "none",
        permissionId: "mail-read",
        toolId: "mail.read_thread",
      },
      {
        argumentTemplate: JSON.stringify({
          team: "approved-team",
          title: "{{message.subject}}",
        }),
        confirmation: "none",
        permissionId: "tasks-write",
        toolId: "linear.save_issue",
      },
    ],
    trigger: { kind: "mail_received" },
    version: 1,
  });

describe("reviewed action authority", () => {
  test("keeps exact account bindings stable across labels and discovery order, while binding actual tool schema", () => {
    const original = compileAgentManifest(specification(), [
      mailRead,
      linearWrite,
    ]);
    const renamed = compileAgentManifest(specification(), [
      { ...linearWrite, accountLabel: "Renamed workspace" },
      mailRead,
    ]);
    const changedSchema = compileAgentManifest(specification(), [
      mailRead,
      {
        ...linearWrite,
        inputSchema: {
          properties: {
            project: { type: "string" },
            title: { type: "string" },
          },
          type: "object",
        },
      },
    ]);
    expect(renamed.digest).toBe(original.digest);
    expect(changedSchema.digest).not.toBe(original.digest);
    expect(() =>
      compileAgentManifest(specification(), [
        mailRead,
        { ...linearWrite, connectionId: "other-account" },
      ])
    ).toThrow(ORPCError);
  });

  test("rejects unmentioned accounts, invented tools and misclassified write grants", () => {
    const unmentioned = specification();
    unmentioned.sourceText = "Use my tasks workspace.";
    expect(() =>
      compileAgentManifest(unmentioned, [mailRead, linearWrite])
    ).toThrow(ORPCError);
    const invented = specification();
    invented.toolGrants[1] = {
      confirmation: "none",
      permissionId: "tasks-write",
      toolId: "linear.delete_issue",
    };
    expect(() =>
      compileAgentManifest(invented, [mailRead, linearWrite])
    ).toThrow(ORPCError);
    const wrongEffect = specification();
    wrongEffect.permissions[1] = {
      connectorReferenceId: "selected",
      id: "tasks-write",
      operation: "read",
      scope: "connector",
    };
    expect(() =>
      compileAgentManifest(wrongEffect, [mailRead, linearWrite])
    ).toThrow(ORPCError);
  });

  test("extracts exact account mentions without treating display labels or duplicate mentions as authority", () => {
    expect(
      resolveMentionedConnectionIds(
        "Use @Linear and @[connection:second] then @[connection:first] and @[connection:second]."
      )
    ).toStrictEqual(["first", "second"]);
  });

  test("blocks shared drafts containing connected account facts and another user's activation", () => {
    const document = specification();
    document.permissions.push({
      id: "mail-write",
      operation: "write",
      scope: "mailbox",
    });
    document.toolGrants.push({
      confirmation: "none",
      permissionId: "mail-write",
      toolId: "mail.save_draft",
    });
    const revision = {
      createdAt: new Date(),
      createdByUserId: "author",
      id: "revision",
      mailboxId: "mailbox",
      manifest: { capabilities: [], entries: [] },
      manifestDigest: "digest",
      specification: document,
      usage: null,
      usageReportedAt: null,
    };
    expect(
      getAgentRevisionView(revision, { shared: true, userId: "author" })
        .canActivate
    ).toBeFalsy();
    expect(
      getAgentRevisionView(revision, { shared: false, userId: "someone-else" })
        .canActivate
    ).toBeFalsy();
    expect(
      getAgentRevisionView(revision, { shared: false, userId: "author" })
        .canActivate
    ).toBeTruthy();
  });

  test("rejects identity injection at the public request boundary", () => {
    expect(
      mailAgentInputs.review.safeParse({
        mailboxId: "mailbox",
        sourceText: "Summarize mail",
        userId: "another-user",
        version: 0,
      }).success
    ).toBeFalsy();
    expect(
      mailAgentInputs.run.safeParse({
        actorUserId: "another-user",
        invocationId: crypto.randomUUID(),
        mailboxId: "mailbox",
        threadId: "thread",
      }).success
    ).toBeFalsy();
  });

  test("blocks personal context in shared inboxes even without a connected account or draft", () => {
    const document = specification();
    document.connectors = [];
    document.permissions = [
      { id: "context", operation: "read", scope: "memory" },
    ];
    document.toolGrants = [
      { confirmation: "none", permissionId: "context", toolId: "memory.read" },
    ];
    const revision = {
      createdAt: new Date(),
      createdByUserId: "author",
      id: "revision",
      mailboxId: "mailbox",
      manifest: { capabilities: [], entries: [] },
      manifestDigest: "digest",
      specification: document,
      usage: null,
      usageReportedAt: null,
    };
    expect(
      getAgentRevisionView(revision, { shared: true, userId: "author" })
        .canActivate
    ).toBeFalsy();
    expect(
      getAgentRevisionView(revision, { shared: false, userId: "author" })
        .canActivate
    ).toBeTruthy();
  });

  test("reauthorizes every settings and run endpoint before loading private data", async () => {
    access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    const input = { mailboxId: "other-mailbox", userId: "actor" };
    await expect(getMailAgentSettings(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      getMailAgentThreadResults({ ...input, threadId: "thread" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      reviewMailAgent({ ...input, sourceText: "Read mail", version: 0 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      activateMailAgent({
        ...input,
        acknowledgeAssumptions: true,
        revisionId: "revision",
        version: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      pauseMailAgent({ ...input, version: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      enqueueManualMailAgentRun({
        ...input,
        invocationId: crypto.randomUUID(),
        threadId: "thread",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
