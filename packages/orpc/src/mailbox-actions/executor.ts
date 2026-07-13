import type { ChatMiddleware } from "@tanstack/ai";
import { ORPCError } from "@orpc/server";
import {
  evaluateMailboxActionCondition,
  MAILBOX_ACTION_CONDITION_MODEL,
  MAILBOX_ACTION_LINEAR_AGENT_MODEL,
  planLinearMcpResearchCalls,
  planLinearIssue,
  routeMailboxAction,
  type ActionEmailInput,
  type ActionExecutionContext,
} from "@quieter/ai/mailbox-actions";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxAction,
  mailboxActionExternalEffect,
  mailboxActionRevision,
  mailboxActionRun,
  mailboxActionRunFrame,
  mailboxActionStepRun,
  managedMailMessage,
} from "@quieter/database/schema";
import { getMessageWithDetails } from "@quieter/gmail";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createLinearIssueForCredential,
  listLinearIssueMetadataForCredential,
  listLinearMcpToolsForCredential,
  runLinearMcpToolCallsForCredential,
  type LinearIssueCreateDraft,
} from "../connectors/runtime";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { MAILBOX_PROVIDER_GMAIL } from "../mailbox/access";
import {
  type MailboxActionGraph,
  type MailboxActionNode,
  validateMailboxActionGraph,
} from "./graph";

type RuntimeFrame = {
  branchPath: string[];
  id: string;
  previousOutputs: Record<string, unknown>;
  variables: Record<string, unknown>;
};

type NodeResult = {
  output: Record<string, unknown>;
  outputPorts: string[];
  variables?: Record<string, unknown>;
};

type MailboxActionUsageMiddlewareFactory = (input: {
  model: typeof MAILBOX_ACTION_CONDITION_MODEL | typeof MAILBOX_ACTION_LINEAR_AGENT_MODEL;
  nodeId: string;
  stepRunId: string;
}) => ChatMiddleware[];

const MAX_NODE_EXECUTIONS = 500;
const RUN_LEASE_MS = 10 * 60 * 1000;

const getNodeById = (graph: MailboxActionGraph) =>
  new Map(graph.nodes.map((node) => [node.id, node]));

const getOutgoingEdges = (graph: MailboxActionGraph, nodeId: string, port: string) =>
  graph.edges.filter((edge) => edge.source === nodeId && edge.sourcePort === port);

const compactEmailInput = (email: ActionEmailInput) => ({
  ...email,
  bodyHtml: email.bodyHtml?.slice(0, 8_000) ?? null,
  bodyText: email.bodyText?.slice(0, 8_000) ?? null,
});

const loadActionEmailInput = async (input: {
  mailboxId: string;
  sourceMessageId: string;
}): Promise<ActionEmailInput> => {
  const [mailboxRecord] = await db
    .select({ ownerUserId: mailbox.ownerUserId, provider: mailbox.provider })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);

  if (!mailboxRecord) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  if (mailboxRecord.provider === MAILBOX_PROVIDER_GMAIL) {
    if (!mailboxRecord.ownerUserId) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    const message = await runAuthorizedGmailMailbox(
      { mailboxId: input.mailboxId, userId: mailboxRecord.ownerUserId },
      async (accessToken) => await getMessageWithDetails(accessToken, input.sourceMessageId),
    );
    return compactEmailInput({
      attachments: message.attachments?.map((attachment) => ({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      })),
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText,
      date: message.date,
      from: message.from,
      id: message.id,
      provider: "gmail",
      snippet: message.snippet,
      subject: message.subject,
      threadId: message.threadId,
      to: message.to,
    });
  }

  const [message] = await db
    .select({
      bodyHtml: managedMailMessage.bodyHtml,
      bodyText: managedMailMessage.bodyText,
      from: managedMailMessage.from,
      id: managedMailMessage.providerMessageId,
      sentAt: managedMailMessage.sentAt,
      snippet: managedMailMessage.snippet,
      subject: managedMailMessage.subject,
      threadId: managedMailMessage.threadId,
      to: managedMailMessage.to,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.providerMessageId, input.sourceMessageId),
      ),
    )
    .limit(1);

  if (!message) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  return compactEmailInput({
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    date: message.sentAt.toISOString(),
    from: message.from,
    id: message.id,
    provider: "managed",
    snippet: message.snippet,
    subject: message.subject,
    threadId: message.threadId,
    to: message.to,
  });
};

const readPathValue = (source: unknown, path: string) => {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = source;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" || typeof current === "number" || typeof current === "boolean"
    ? String(current)
    : "";
};

const renderTemplate = (
  value: string | undefined,
  input: { context: ActionExecutionContext; email: ActionEmailInput },
) =>
  (value ?? "").replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    if (path.startsWith("email.")) return readPathValue(input.email, path.slice("email.".length));
    if (path.startsWith("variables.")) {
      return readPathValue(input.context.variables, path.slice("variables.".length));
    }
    if (path.startsWith("outputs.")) {
      return readPathValue(input.context.previousOutputs, path.slice("outputs.".length));
    }
    return "";
  });

const validateLinearPlan = (
  issue: LinearIssueCreateDraft,
  metadata: Awaited<ReturnType<typeof listLinearIssueMetadataForCredential>>,
) => {
  const teamIds = new Set(metadata.teams.map((team) => team.id));
  const labelIds = new Set(
    metadata.labels.filter((label) => !label.isGroup).map((label) => label.id),
  );
  const projectIds = new Set(metadata.projects.map((project) => project.id));
  const stateIds = new Set(metadata.states.map((state) => state.id));
  const assignableUserIds = new Set(
    metadata.users.filter((user) => user.active && user.isAssignable).map((user) => user.id),
  );
  if (!teamIds.has(issue.teamId)) throw new Error("Linear team is not available.");
  if (issue.projectId && !projectIds.has(issue.projectId))
    throw new Error("Linear project is not available.");
  if (issue.stateId && !stateIds.has(issue.stateId))
    throw new Error("Linear state is not available.");
  if (issue.assigneeId && !assignableUserIds.has(issue.assigneeId)) {
    throw new Error("Linear assignee is not available.");
  }
  for (const labelId of issue.labelIds ?? []) {
    if (!labelIds.has(labelId)) throw new Error("Linear label is not available.");
  }
};

const createLinearExternalEffect = async (input: {
  actionId: string;
  connectorCredentialId: string;
  issue: LinearIssueCreateDraft;
  nodeId: string;
  revisionId: string;
  runId: string;
  stepRunId: string;
}) => {
  const idempotencyKey = `${input.runId}:${input.nodeId}`;
  const [existing] = await db
    .select({
      externalId: mailboxActionExternalEffect.externalId,
      externalUrl: mailboxActionExternalEffect.externalUrl,
    })
    .from(mailboxActionExternalEffect)
    .where(eq(mailboxActionExternalEffect.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing) {
    return { id: existing.externalId, url: existing.externalUrl ?? undefined };
  }

  const issue = await createLinearIssueForCredential({
    credentialId: input.connectorCredentialId,
    issue: input.issue,
  });
  await db.insert(mailboxActionExternalEffect).values({
    actionId: input.actionId,
    connectorCredentialId: input.connectorCredentialId,
    createdAt: new Date(),
    externalId: issue.id,
    externalUrl: issue.url,
    id: randomUUID(),
    idempotencyKey,
    metadata: { identifier: issue.identifier, title: issue.title },
    provider: "linear",
    revisionId: input.revisionId,
    runId: input.runId,
    stepRunId: input.stepRunId,
  });
  return issue;
};

const executeNode = async (input: {
  actionId: string;
  email: ActionEmailInput;
  frame: RuntimeFrame;
  node: MailboxActionNode;
  revisionId: string;
  runId: string;
  stepRunId: string;
  usageMiddleware: MailboxActionUsageMiddlewareFactory;
}): Promise<NodeResult> => {
  const context: ActionExecutionContext = {
    branchPath: input.frame.branchPath,
    previousOutputs: input.frame.previousOutputs,
    variables: input.frame.variables,
  };

  switch (input.node.type) {
    case "email_received":
      return { output: { messageId: input.email.id }, outputPorts: ["out"] };
    case "ai_condition": {
      const result = await evaluateMailboxActionCondition({
        context,
        criteria: input.node.config.criteria,
        email: input.email,
        middleware: input.usageMiddleware({
          model: MAILBOX_ACTION_CONDITION_MODEL,
          nodeId: input.node.id,
          stepRunId: input.stepRunId,
        }),
      });
      return {
        output: result,
        outputPorts: [result.matches ? "yes" : "no"],
      };
    }
    case "ai_router": {
      const ports = [...new Set([...input.node.config.ports, input.node.config.fallbackPort])];
      const result = await routeMailboxAction({
        context,
        email: input.email,
        fallbackPort: input.node.config.fallbackPort,
        middleware: input.usageMiddleware({
          model: MAILBOX_ACTION_CONDITION_MODEL,
          nodeId: input.node.id,
          stepRunId: input.stepRunId,
        }),
        ports,
        routingInstructions: input.node.config.instructions,
      });
      return { output: result, outputPorts: [result.outputPort] };
    }
    case "set_variable":
      return {
        output: { [input.node.config.name]: input.node.config.value },
        outputPorts: ["out"],
        variables: { [input.node.config.name]: input.node.config.value },
      };
    case "merge":
      return { output: { mode: input.node.config.mode }, outputPorts: ["out"] };
    case "stop":
      return { output: { stopped: true }, outputPorts: [] };
    case "linear_create_issue": {
      if (
        !input.node.config.credentialId ||
        !input.node.config.teamId ||
        !input.node.config.title
      ) {
        throw new Error("Linear issue node is missing required configuration.");
      }
      const issue: LinearIssueCreateDraft = {
        assigneeId: input.node.config.assigneeId,
        description: renderTemplate(input.node.config.description, { context, email: input.email }),
        labelIds: input.node.config.labelIds,
        priority: input.node.config.priority,
        projectId: input.node.config.projectId,
        stateId: input.node.config.stateId,
        teamId: input.node.config.teamId,
        title: renderTemplate(input.node.config.title, { context, email: input.email }),
      };
      const createdIssue = await createLinearExternalEffect({
        actionId: input.actionId,
        connectorCredentialId: input.node.config.credentialId,
        issue,
        nodeId: input.node.id,
        revisionId: input.revisionId,
        runId: input.runId,
        stepRunId: input.stepRunId,
      });
      return { output: { issue: createdIssue }, outputPorts: ["success"] };
    }
    case "linear_agent_issue": {
      if (!input.node.config.credentialId || !input.node.config.teamId) {
        throw new Error("Linear agent node is missing required configuration.");
      }
      const metadata = await listLinearIssueMetadataForCredential({
        credentialId: input.node.config.credentialId,
      });
      const mcpTools = await listLinearMcpToolsForCredential({
        credentialId: input.node.config.credentialId,
      });
      const mcpResearchPlan =
        mcpTools.length > 0
          ? await planLinearMcpResearchCalls({
              context,
              email: input.email,
              instructions: input.node.config.instructions,
              middleware: input.usageMiddleware({
                model: MAILBOX_ACTION_LINEAR_AGENT_MODEL,
                nodeId: input.node.id,
                stepRunId: input.stepRunId,
              }),
              teamId: input.node.config.teamId,
              tools: mcpTools,
            })
          : { calls: [] };
      const mcpResearch =
        mcpResearchPlan.calls.length > 0
          ? await runLinearMcpToolCallsForCredential({
              calls: mcpResearchPlan.calls.map((call) => ({
                arguments: call.arguments,
                toolName: call.toolName,
              })),
              credentialId: input.node.config.credentialId,
            })
          : [];
      const plan = await planLinearIssue({
        context,
        email: input.email,
        instructions: input.node.config.instructions,
        linear: metadata,
        linearMcpResearch: mcpResearch,
        middleware: input.usageMiddleware({
          model: MAILBOX_ACTION_LINEAR_AGENT_MODEL,
          nodeId: input.node.id,
          stepRunId: input.stepRunId,
        }),
        teamId: input.node.config.teamId,
      });
      const issue: LinearIssueCreateDraft = {
        assigneeId: plan.assigneeId,
        description: plan.description,
        labelIds: plan.labelIds,
        priority: plan.priority,
        projectId: plan.projectId,
        stateId: plan.stateId,
        teamId: plan.teamId,
        title: plan.title,
      };
      validateLinearPlan(issue, metadata);
      const createdIssue = await createLinearExternalEffect({
        actionId: input.actionId,
        connectorCredentialId: input.node.config.credentialId,
        issue,
        nodeId: input.node.id,
        revisionId: input.revisionId,
        runId: input.runId,
        stepRunId: input.stepRunId,
      });
      return {
        output: { issue: createdIssue, mcpResearch, mcpResearchPlan, plan },
        outputPorts: ["success"],
      };
    }
  }
};

const claimRun = async (runId: string) => {
  const now = new Date();
  const [run] = await db
    .update(mailboxActionRun)
    .set({
      attempts: sql`${mailboxActionRun.attempts} + 1`,
      leasedUntil: new Date(now.getTime() + RUN_LEASE_MS),
      startedAt: now,
      status: "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(mailboxActionRun.id, runId),
        or(
          eq(mailboxActionRun.status, "queued"),
          and(
            eq(mailboxActionRun.status, "running"),
            or(isNull(mailboxActionRun.leasedUntil), lt(mailboxActionRun.leasedUntil, now)),
          ),
        ),
      ),
    )
    .returning({
      actionId: mailboxActionRun.actionId,
      id: mailboxActionRun.id,
      mailboxId: mailboxActionRun.mailboxId,
      revisionId: mailboxActionRun.revisionId,
      sourceMessageId: mailboxActionRun.sourceMessageId,
      triggerNodeId: mailboxActionRun.triggerNodeId,
    });

  return run ?? null;
};

export const executeMailboxActionRun = async (runId: string) => {
  const run = await claimRun(runId);
  if (!run) return { status: "not_claimed" as const };

  try {
    const [revision] = await db
      .select({ graph: mailboxActionRevision.graph })
      .from(mailboxActionRevision)
      .where(eq(mailboxActionRevision.id, run.revisionId))
      .limit(1);
    if (!revision) throw new Error("Action revision was not found.");

    const validation = validateMailboxActionGraph(revision.graph);
    if (!validation.graph) {
      throw new Error("Action revision graph is invalid.");
    }
    const graph = validation.graph;
    const [actionOwner] = await db
      .select({ userId: mailboxAction.createdByUserId })
      .from(mailboxAction)
      .where(eq(mailboxAction.id, run.actionId))
      .limit(1);
    const usageIndexesByStepRunId = new Map<string, number>();
    const createUsageMiddleware: MailboxActionUsageMiddlewareFactory = ({
      model,
      nodeId,
      stepRunId,
    }) => {
      const billingUserId = actionOwner?.userId;
      if (!billingUserId) return [];
      return [
        {
          name: "mailbox-action-ai-usage",
          onUsage: (usageContext, usage) => {
            const usageIndex = usageIndexesByStepRunId.get(stepRunId) ?? 0;
            usageIndexesByStepRunId.set(stepRunId, usageIndex + 1);
            const externalId = `mailbox-action:${run.id}:${stepRunId}:${usageIndex}`;
            usageContext.defer(
              reportAiUsage({
                costUsd: usage.cost,
                completionTokens: usage.completionTokens,
                externalId,
                mailboxId: run.mailboxId,
                model,
                promptTokens: usage.promptTokens,
                promptTokensDetails: usage.promptTokensDetails,
                usageKind: "aiChat",
                userId: billingUserId,
              }).catch((error) => {
                console.error("Could not report mailbox action AI usage.", {
                  error: error instanceof Error ? error.message : "Unknown error.",
                  nodeId,
                  runId: run.id,
                });
              }),
            );
          },
        },
      ];
    };
    const email = await loadActionEmailInput({
      mailboxId: run.mailboxId,
      sourceMessageId: run.sourceMessageId,
    });
    const nodesById = getNodeById(graph);
    const triggerNode = nodesById.get(run.triggerNodeId);
    if (!triggerNode) throw new Error("Trigger node was not found.");

    const now = new Date();
    const initialFrameId = randomUUID();
    await db.insert(mailboxActionRunFrame).values({
      createdAt: now,
      id: initialFrameId,
      path: [triggerNode.id],
      runId: run.id,
      status: "running",
      updatedAt: now,
      variables: {},
    });
    const queue: Array<{ frame: RuntimeFrame; node: MailboxActionNode }> = [
      {
        frame: {
          branchPath: [triggerNode.id],
          id: initialFrameId,
          previousOutputs: {},
          variables: {},
        },
        node: triggerNode,
      },
    ];

    let executedCount = 0;
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      executedCount += 1;
      if (executedCount > MAX_NODE_EXECUTIONS) {
        throw new Error("Workflow exceeded the node execution limit.");
      }

      const stepRunId = randomUUID();
      const stepStartedAt = new Date();
      const stepInput = {
        branchPath: item.frame.branchPath,
        email: compactEmailInput(email),
        nodeConfig: item.node.config,
        previousOutputs: item.frame.previousOutputs,
        variables: item.frame.variables,
      };
      await db.insert(mailboxActionStepRun).values({
        createdAt: stepStartedAt,
        frameId: item.frame.id,
        id: stepRunId,
        input: stepInput,
        nodeId: item.node.id,
        nodeType: item.node.type,
        runId: run.id,
        startedAt: stepStartedAt,
        status: "running",
        updatedAt: stepStartedAt,
      });

      const result = await executeNode({
        actionId: run.actionId,
        email,
        frame: item.frame,
        node: item.node,
        revisionId: run.revisionId,
        runId: run.id,
        stepRunId,
        usageMiddleware: createUsageMiddleware,
      });
      const mergedVariables = { ...item.frame.variables, ...result.variables };
      const previousOutputs = { ...item.frame.previousOutputs, [item.node.id]: result.output };
      const stepCompletedAt = new Date();
      await db
        .update(mailboxActionStepRun)
        .set({
          completedAt: stepCompletedAt,
          output: result.output,
          status: "succeeded",
          updatedAt: stepCompletedAt,
        })
        .where(eq(mailboxActionStepRun.id, stepRunId));
      await db
        .update(mailboxActionRunFrame)
        .set({ updatedAt: stepCompletedAt, variables: mergedVariables })
        .where(eq(mailboxActionRunFrame.id, item.frame.id));

      for (const outputPort of result.outputPorts) {
        for (const edge of getOutgoingEdges(graph, item.node.id, outputPort)) {
          const targetNode = nodesById.get(edge.target);
          if (!targetNode) continue;
          const childFrameId = randomUUID();
          const childPath = [
            ...item.frame.branchPath,
            `${item.node.id}:${outputPort}`,
            targetNode.id,
          ];
          await db.insert(mailboxActionRunFrame).values({
            createdAt: stepCompletedAt,
            id: childFrameId,
            parentFrameId: item.frame.id,
            path: childPath,
            runId: run.id,
            status: "running",
            updatedAt: stepCompletedAt,
            variables: mergedVariables,
          });
          queue.push({
            frame: {
              branchPath: childPath,
              id: childFrameId,
              previousOutputs,
              variables: mergedVariables,
            },
            node: targetNode,
          });
        }
      }
    }

    const completedAt = new Date();
    await db
      .update(mailboxActionRun)
      .set({
        completedAt,
        leasedUntil: null,
        status: executedCount === 1 ? "skipped" : "succeeded",
        updatedAt: completedAt,
      })
      .where(eq(mailboxActionRun.id, run.id));
    return { status: "succeeded" as const };
  } catch (error) {
    const failedAt = new Date();
    await db
      .update(mailboxActionRun)
      .set({
        completedAt: failedAt,
        lastError: error instanceof Error ? error.message : "Mailbox action failed.",
        leasedUntil: null,
        status: "failed",
        updatedAt: failedAt,
      })
      .where(eq(mailboxActionRun.id, run.id));
    throw error;
  }
};
