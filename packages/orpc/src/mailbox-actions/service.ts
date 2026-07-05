import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  mailbox,
  mailboxAction,
  mailboxActionRevision,
} from "@quieter/database/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox, MAILBOX_PROVIDER_GMAIL } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";
import { assertOrganizationManager } from "../organization/divisions";
import {
  createDefaultMailboxActionGraph,
  type MailboxActionGraph,
  type MailboxActionNode,
  type MailboxActionValidationIssue,
  validateMailboxActionGraph,
} from "./graph";

const RECENT_REVISION_LIMIT = 50;

const assertMailboxActionConfigurator = async (input: { mailboxId: string; userId: string }) => {
  const [record] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.ownerUserId,
      provider: mailbox.provider,
    })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);

  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  if (record.provider === MAILBOX_PROVIDER_GMAIL) {
    if (record.ownerUserId !== input.userId) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    return record;
  }

  try {
    await getAuthorizedManagedMailbox({
      mailboxId: input.mailboxId,
      requiredRoles: ["manager"],
      userId: input.userId,
    });
    return record;
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
  }

  await assertOrganizationManager({
    organizationId: record.organizationId,
    userId: input.userId,
  });
  return record;
};

const getActionForUser = async (input: { actionId: string; userId: string }) => {
  const [record] = await db
    .select({
      draftRevisionId: mailboxAction.draftRevisionId,
      enabled: mailboxAction.enabled,
      id: mailboxAction.id,
      mailboxId: mailboxAction.mailboxId,
      name: mailboxAction.name,
      organizationId: mailboxAction.organizationId,
      publishedRevisionId: mailboxAction.publishedRevisionId,
      status: mailboxAction.status,
      statusReason: mailboxAction.statusReason,
    })
    .from(mailboxAction)
    .where(eq(mailboxAction.id, input.actionId))
    .limit(1);

  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "Action not found." });
  }

  await assertAccessibleMailbox({ mailboxId: record.mailboxId, userId: input.userId });
  return record;
};

const getConfigurableActionForUser = async (input: { actionId: string; userId: string }) => {
  const action = await getActionForUser(input);
  await assertMailboxActionConfigurator({ mailboxId: action.mailboxId, userId: input.userId });
  return action;
};

const linearNodes = (graph: MailboxActionGraph) =>
  graph.nodes.filter(
    (
      node,
    ): node is Extract<MailboxActionNode, { type: "linear_agent_issue" | "linear_create_issue" }> =>
      node.type === "linear_agent_issue" || node.type === "linear_create_issue",
  );

const validateLinearCredentialOwnershipIssues = async (input: {
  graph: MailboxActionGraph;
  userId: string;
}): Promise<MailboxActionValidationIssue[]> => {
  const issues: MailboxActionValidationIssue[] = [];
  for (const node of linearNodes(input.graph)) {
    if (!node.config.credentialId) continue;
    const [credential] = await db
      .select({ id: connectorCredential.id })
      .from(connectorCredential)
      .where(
        and(
          eq(connectorCredential.id, node.config.credentialId),
          eq(connectorCredential.provider, "linear"),
          eq(connectorCredential.status, "connected"),
          eq(connectorCredential.userId, input.userId),
        ),
      )
      .limit(1);
    if (!credential) {
      issues.push({
        message: `Linear node ${node.id} uses a Linear account that is not connected.`,
        nodeId: node.id,
      });
    }
  }
  return issues;
};

export const listMailboxActions = async (input: { mailboxId: string; userId: string }) => {
  await assertAccessibleMailbox(input);
  const rows = await db
    .select({
      draftRevisionId: mailboxAction.draftRevisionId,
      enabled: mailboxAction.enabled,
      id: mailboxAction.id,
      name: mailboxAction.name,
      publishedRevisionId: mailboxAction.publishedRevisionId,
      status: mailboxAction.status,
      statusReason: mailboxAction.statusReason,
      updatedAt: mailboxAction.updatedAt,
    })
    .from(mailboxAction)
    .where(eq(mailboxAction.mailboxId, input.mailboxId))
    .orderBy(desc(mailboxAction.updatedAt));

  return { actions: rows };
};

export const getMailboxAction = async (input: { actionId: string; userId: string }) => {
  const action = await getActionForUser(input);
  const revisions = await db
    .select({
      createdAt: mailboxActionRevision.createdAt,
      graph: mailboxActionRevision.graph,
      id: mailboxActionRevision.id,
      revisionNumber: mailboxActionRevision.revisionNumber,
      validationErrors: mailboxActionRevision.validationErrors,
      validationStatus: mailboxActionRevision.validationStatus,
    })
    .from(mailboxActionRevision)
    .where(eq(mailboxActionRevision.actionId, action.id))
    .orderBy(desc(mailboxActionRevision.revisionNumber))
    .limit(RECENT_REVISION_LIMIT);

  return {
    action,
    revisions: revisions.map((revision) => ({
      ...revision,
      validationIssues: validateMailboxActionGraph(revision.graph).issues,
    })),
  };
};

export const createMailboxAction = async (input: {
  mailboxId: string;
  name?: string;
  userId: string;
}) => {
  const selectedMailbox = await assertMailboxActionConfigurator(input);
  const now = new Date();
  const actionId = randomUUID();
  const revisionId = randomUUID();
  const graph = createDefaultMailboxActionGraph();
  const validation = validateMailboxActionGraph(graph);

  await db.transaction(async (tx) => {
    await tx.insert(mailboxAction).values({
      createdAt: now,
      createdByUserId: input.userId,
      enabled: false,
      id: actionId,
      mailboxId: input.mailboxId,
      name: input.name?.trim() || "New action",
      organizationId: selectedMailbox.organizationId,
      status: "ready",
      updatedAt: now,
    });
    await tx.insert(mailboxActionRevision).values({
      actionId,
      createdAt: now,
      createdByUserId: input.userId,
      graph,
      id: revisionId,
      revisionNumber: 1,
      validationErrors: validation.errors,
      validationStatus: validation.valid ? "valid" : "invalid",
    });
    await tx
      .update(mailboxAction)
      .set({ draftRevisionId: revisionId, updatedAt: now })
      .where(eq(mailboxAction.id, actionId));
  });

  return { actionId };
};

export const saveMailboxActionDraft = async (input: {
  actionId: string;
  graph: unknown;
  name?: string;
  userId: string;
}) => {
  const action = await getConfigurableActionForUser(input);
  const parsed = validateMailboxActionGraph(input.graph);
  if (!parsed.graph) {
    throw new ORPCError("BAD_REQUEST", {
      message: parsed.errors.join(" "),
    });
  }

  const now = new Date();
  const revisionId = randomUUID();
  let revisionNumber = 1;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from "mailboxAction" where "id" = ${action.id} for update`);
    const [latestRevision] = await tx
      .select({ revisionNumber: mailboxActionRevision.revisionNumber })
      .from(mailboxActionRevision)
      .where(eq(mailboxActionRevision.actionId, action.id))
      .orderBy(desc(mailboxActionRevision.revisionNumber))
      .limit(1);

    revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
    await tx.insert(mailboxActionRevision).values({
      actionId: action.id,
      createdAt: now,
      createdByUserId: input.userId,
      graph: parsed.graph,
      id: revisionId,
      revisionNumber,
      validationErrors: parsed.errors,
      validationStatus: parsed.valid ? "valid" : "invalid",
    });
    await tx
      .update(mailboxAction)
      .set({
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        draftRevisionId: revisionId,
        updatedAt: now,
      })
      .where(eq(mailboxAction.id, action.id));
  });

  return {
    revisionId,
    validationErrors: parsed.errors,
    validationStatus: parsed.valid ? "valid" : "invalid",
  };
};

export const publishMailboxAction = async (input: { actionId: string; userId: string }) => {
  const action = await getConfigurableActionForUser(input);
  if (!action.draftRevisionId) {
    throw new ORPCError("BAD_REQUEST", { message: "Save a draft before publishing." });
  }

  const [draft] = await db
    .select({
      graph: mailboxActionRevision.graph,
      id: mailboxActionRevision.id,
      validationErrors: mailboxActionRevision.validationErrors,
      validationStatus: mailboxActionRevision.validationStatus,
    })
    .from(mailboxActionRevision)
    .where(eq(mailboxActionRevision.id, action.draftRevisionId))
    .limit(1);

  if (!draft) {
    throw new ORPCError("BAD_REQUEST", { message: "Draft revision was not found." });
  }

  const validation = validateMailboxActionGraph(draft.graph);
  const credentialIssues = validation.graph
    ? await validateLinearCredentialOwnershipIssues({
        graph: validation.graph,
        userId: input.userId,
      })
    : [];
  const validationErrors = [...validation.issues, ...credentialIssues].map(
    (issue) => issue.message,
  );
  if (validationErrors.length > 0) {
    await db
      .update(mailboxActionRevision)
      .set({ validationErrors, validationStatus: "invalid" })
      .where(eq(mailboxActionRevision.id, draft.id));
    throw new ORPCError("BAD_REQUEST", { message: validationErrors.join(" ") });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(mailboxActionRevision)
      .set({ validationErrors: [], validationStatus: "valid" })
      .where(eq(mailboxActionRevision.id, draft.id));
    await tx
      .update(mailboxAction)
      .set({
        publishedRevisionId: draft.id,
        status: "ready",
        statusReason: null,
        updatedAt: now,
      })
      .where(eq(mailboxAction.id, action.id));
  });

  return { publishedRevisionId: draft.id };
};

export const setMailboxActionEnabled = async (input: {
  actionId: string;
  enabled: boolean;
  userId: string;
}) => {
  const action = await getConfigurableActionForUser(input);
  if (input.enabled && !action.publishedRevisionId) {
    throw new ORPCError("BAD_REQUEST", { message: "Publish this action before enabling it." });
  }

  const now = new Date();
  await db
    .update(mailboxAction)
    .set({ enabled: input.enabled, updatedAt: now })
    .where(eq(mailboxAction.id, action.id));

  return { enabled: input.enabled };
};

export const deleteMailboxAction = async (input: { actionId: string; userId: string }) => {
  const action = await getConfigurableActionForUser(input);
  await db.delete(mailboxAction).where(eq(mailboxAction.id, action.id));
  return { deleted: true as const };
};
