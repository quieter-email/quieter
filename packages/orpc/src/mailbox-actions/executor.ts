import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import {
  CONNECTOR_AGENT_MAX_WRITE_CALLS,
  evaluateMailboxActionCondition,
  MAILBOX_ACTION_CONDITION_MODEL,
  MAILBOX_ACTION_CONNECTOR_AGENT_MODEL,
  routeMailboxAction,
  runConnectorAgentStep,
} from "@quieter/ai/mailbox-actions";
import type {
  ActionEmailInput,
  ActionExecutionContext,
} from "@quieter/ai/mailbox-actions";
import { reportAiUsage } from "@quieter/billing";
import { getAiUsageCostMicroCents } from "@quieter/billing/ai-pricing";
import {
  getBillingCreditUsage,
  reserveAiCredits,
} from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import type { ConnectorProvider } from "@quieter/database/schema";
import {
  mailbox,
  billingCreditReservation,
  mailboxAction,
  mailboxActionRevision,
  mailboxActionRun,
  mailboxActionStepRun,
  managedMailMessage,
} from "@quieter/database/schema";
import { getMessageWithDetails } from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  buildMailMemoryQuery,
  loadAiAgentContext,
  serializeAiAgentContext,
} from "../ai-memory";
import {
  listConnectorAgentTools,
  runConnectorAgentReadCalls,
} from "../connectors/agent-tools";
import type {
  ConnectorAgentTool,
  ConnectorAgentToolCall,
} from "../connectors/agent-tools";
import { getConnectorDisplayName } from "../connectors/contracts";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { MAILBOX_PROVIDER_GMAIL } from "../mailbox/access";
import { assertMailboxActionConfigurator } from "./access";
import { runConnectorWriteCall } from "./effects";
import { validateMailboxActionGraph } from "./graph";
import type { MailboxActionNode } from "./graph";
import { claimMailboxActionRun, withMailboxActionRun } from "./lease";

type RuntimeFrame = {
  branchPath: string[];
  previousOutputs: Record<string, unknown>;
  variables: Record<string, unknown>;
};

const nodeResultSchema = z.object({
  output: z.record(z.string(), z.unknown()),
  outputPorts: z.array(z.string()),
  variables: z.record(z.string(), z.unknown()).optional(),
});
type NodeResult = z.infer<typeof nodeResultSchema>;

type MailboxActionUsageReporter = (input: {
  model: typeof MAILBOX_ACTION_CONDITION_MODEL;
  nodeId: string;
  stepRunId: string;
}) => ((usage: AiUsageReport) => void) | undefined;

const MAX_NODE_EXECUTIONS = 500;
const RUN_BUDGET_MS = 4 * 60 * 1000;
/** A step should finish while the mail still feels freshly handled. */
const CONNECTOR_STEP_BUDGET_MS = 45 * 1000;

const compactEmailInput = (email: ActionEmailInput) => ({
  ...email,
  bodyHtml: email.bodyHtml?.slice(0, 8000) ?? null,
  bodyText: email.bodyText?.slice(0, 8000) ?? null,
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

  if (mailboxRecord === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  if (mailboxRecord.provider === MAILBOX_PROVIDER_GMAIL) {
    if (!mailboxRecord.ownerUserId) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    const message = await runAuthorizedGmailMailbox(
      { mailboxId: input.mailboxId, userId: mailboxRecord.ownerUserId },
      async (accessToken) =>
        await getMessageWithDetails(accessToken, input.sourceMessageId)
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
        eq(managedMailMessage.providerMessageId, input.sourceMessageId)
      )
    )
    .limit(1);

  if (message === undefined) {
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

const toolArgumentsSchema = z.record(z.string(), z.unknown());

type ConnectorStepIdentity = {
  attempts: number;
  invocationPath: string[];
  actionId: string;
  credentialId: string;
  nodeId: string;
  provider: ConnectorProvider;
  revisionId: string;
  runId: string;
  stepRunId: string;
  userId: string;
  signal?: AbortSignal;
};

/**
 * Turns the connector's advertised tools into ones the agent loop can actually
 * call. Reads pass straight through; writes are counted, capped, and recorded
 * so a replayed run cannot repeat them.
 */
const createConnectorStepTools = (
  identity: ConnectorStepIdentity,
  tools: ConnectorAgentTool[],
  effects: Awaited<ReturnType<typeof runConnectorWriteCall>>[]
): ToolSet => {
  // Reserved synchronously before each write awaits, so parallel tool calls in
  // one step cannot collide on the same idempotency key.
  let nextWriteCallIndex = 0;
  return Object.fromEntries(
    tools.map((connectorTool) => [
      connectorTool.name,
      tool({
        description: connectorTool.description ?? connectorTool.name,
        execute: async (args) => {
          const call: ConnectorAgentToolCall = {
            arguments: toolArgumentsSchema.parse(args ?? {}),
            toolName: connectorTool.name,
          };

          if (!connectorTool.mutates) {
            const [result] = await runConnectorAgentReadCalls({
              calls: [call],
              credentialId: identity.credentialId,
              provider: identity.provider,
              signal: identity.signal,
              userId: identity.userId,
            });
            return (
              result ?? { error: "Tool returned nothing.", status: "error" }
            );
          }

          if (nextWriteCallIndex >= CONNECTOR_AGENT_MAX_WRITE_CALLS) {
            return {
              error: `This step has already made ${CONNECTOR_AGENT_MAX_WRITE_CALLS} changes, which is the limit. Finish without further changes.`,
              status: "error",
            };
          }
          const callIndex = nextWriteCallIndex;
          nextWriteCallIndex += 1;

          const result = await runConnectorWriteCall({
            ...identity,
            call,
            callIndex,
          });
          effects[callIndex] = result;
          return result;
        },
        inputSchema: jsonSchema<Record<string, unknown>>(
          connectorTool.inputSchema
        ),
      }),
    ])
  );
};

const executeNode = async (input: {
  attempts: number;
  actionId: string;
  email: ActionEmailInput;
  frame: RuntimeFrame;
  memoryContext: string | null;
  node: MailboxActionNode;
  revisionId: string;
  runId: string;
  stepRunId: string;
  userId: string;
  signal?: AbortSignal;
  usageReporter: MailboxActionUsageReporter;
}): Promise<NodeResult> => {
  const context: ActionExecutionContext = {
    branchPath: input.frame.branchPath,
    previousOutputs: input.frame.previousOutputs,
    variables: input.frame.variables,
  };

  switch (input.node.type) {
    case "email_received": {
      return { output: { messageId: input.email.id }, outputPorts: ["out"] };
    }
    case "ai_condition": {
      const result = await evaluateMailboxActionCondition({
        abortSignal: input.signal,
        context,
        criteria: input.node.config.criteria,
        email: input.email,
        memoryContext: input.memoryContext,
        onUsage: input.usageReporter({
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
      const ports = [
        ...new Set([
          ...input.node.config.ports,
          input.node.config.fallbackPort,
        ]),
      ];
      const result = await routeMailboxAction({
        abortSignal: input.signal,
        context,
        email: input.email,
        fallbackPort: input.node.config.fallbackPort,
        memoryContext: input.memoryContext,
        onUsage: input.usageReporter({
          model: MAILBOX_ACTION_CONDITION_MODEL,
          nodeId: input.node.id,
          stepRunId: input.stepRunId,
        }),
        ports,
        routingInstructions: input.node.config.instructions,
      });
      return { output: result, outputPorts: [result.outputPort] };
    }
    case "set_variable": {
      return {
        output: { [input.node.config.name]: input.node.config.value },
        outputPorts: ["out"],
        variables: { [input.node.config.name]: input.node.config.value },
      };
    }
    case "merge": {
      return { output: { mode: input.node.config.mode }, outputPorts: ["out"] };
    }
    case "stop": {
      return { output: { stopped: true }, outputPorts: [] };
    }
    case "connector_agent": {
      const { credentialId, instructions, provider } = input.node.config;

      if (!credentialId || provider === undefined) {
        throw new Error("Connector step is missing its app or account.");
      }

      const connectorName = getConnectorDisplayName(provider);
      const signal =
        input.signal ?? AbortSignal.timeout(CONNECTOR_STEP_BUDGET_MS);
      const tools = await listConnectorAgentTools({
        credentialId,
        provider,
        signal,
        userId: input.userId,
      });
      const effects: Awaited<ReturnType<typeof runConnectorWriteCall>>[] = [];
      const identity = {
        actionId: input.actionId,
        attempts: input.attempts,
        credentialId,
        invocationPath: input.frame.branchPath,
        nodeId: input.node.id,
        provider,
        revisionId: input.revisionId,
        runId: input.runId,
        signal,
        stepRunId: input.stepRunId,
        userId: input.userId,
      };

      try {
        const result = await runConnectorAgentStep({
          abortSignal: signal,
          connectorName,
          context,
          email: input.email,
          instructions,
          memoryContext: input.memoryContext,
          onUsage: input.usageReporter({
            model: MAILBOX_ACTION_CONNECTOR_AGENT_MODEL,
            nodeId: input.node.id,
            stepRunId: input.stepRunId,
          }),
          tools: createConnectorStepTools(identity, tools, effects),
        });

        return {
          output: {
            connector: connectorName,
            effects,
            outcome: result.outcome,
            summary: result.summary,
          },
          outputPorts: ["success"],
        };
      } catch (error) {
        // Changes already made are real, so report them rather than losing them
        // to a timeout or a model error partway through the loop.
        if (
          effects.length === 0 ||
          (error instanceof ORPCError && error.code === "CONFLICT")
        ) {
          throw error;
        }

        return {
          output: {
            connector: connectorName,
            effects,
            outcome: "acted",
            summary:
              error instanceof Error
                ? `Stopped early: ${error.message}`
                : "Stopped early.",
          },
          outputPorts: ["success"],
        };
      }
    }
    default: {
      throw new Error("Unsupported node type.");
    }
  }
};

export type MailboxActionFailureUpdate = {
  completedAt: Date | null;
  lastError: string;
  leasedUntil: null;
  status: "failed" | "queued" | "needs_review";
  updatedAt: Date;
};

/**
 * Transient failures return the run to `queued` so the redelivered queue
 * message can claim it again; only the final queue delivery settles the run
 * as `failed`. Finality mirrors the Cloudflare Queues retry limit configured
 * in infra/actions.ts (retry: 5, so the sixth failed delivery goes to the DLQ).
 */
export const mailboxActionFailureUpdate = (
  error: unknown,
  options: { finalAttempt: boolean }
): MailboxActionFailureUpdate => {
  const at = new Date();
  const lastError =
    error instanceof Error ? error.message : "Mailbox action failed.";
  if (error instanceof ORPCError && error.code === "CONFLICT") {
    return {
      completedAt: at,
      lastError,
      leasedUntil: null,
      status: "needs_review",
      updatedAt: at,
    };
  }
  if (
    options.finalAttempt ||
    (error instanceof ORPCError &&
      (error.code === "FORBIDDEN" || error.code === "NOT_FOUND"))
  ) {
    return {
      completedAt: at,
      lastError,
      leasedUntil: null,
      status: "failed",
      updatedAt: at,
    };
  }

  return {
    completedAt: null,
    lastError,
    leasedUntil: null,
    status: "queued",
    updatedAt: at,
  };
};

const ACTION_ALLOWANCE_MICROCENTS = 25 * 1_000_000;

const getActionExecutionEntitlement = async (input: {
  actionId: string;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertMailboxActionConfigurator(input);
  const [action] = await db
    .select({ enabled: mailboxAction.enabled })
    .from(mailboxAction)
    .where(
      and(
        eq(mailboxAction.id, input.actionId),
        eq(mailboxAction.mailboxId, input.mailboxId)
      )
    )
    .limit(1);
  if (!action?.enabled) {
    throw new ORPCError("FORBIDDEN", { message: "This action is disabled." });
  }
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: selectedMailbox.organizationId,
    userId: input.userId,
  });
  if (
    !entitlement.hasAccess ||
    (!entitlement.hasUnlimitedAccess && entitlement.account === null)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "This action requires an active AI plan and available usage balance.",
    });
  }
  if (entitlement.account !== null && !entitlement.hasUnlimitedAccess) {
    const usage = await getBillingCreditUsage(entitlement.account);
    if (usage.costMicroCents >= usage.creditAmountMicroCents) {
      throw new ORPCError("FORBIDDEN", {
        message: "This action requires available usage balance.",
      });
    }
  }
  return entitlement;
};

export const executeMailboxActionRun = async (
  runId: string,
  options?: { finalAttempt?: boolean }
) => {
  const run = await claimMailboxActionRun(runId);
  if (run === null) {
    return { status: "not_claimed" as const };
  }

  const signal = AbortSignal.timeout(RUN_BUDGET_MS);
  const usageTasks: Promise<void>[] = [];
  let usageFailure: Error | undefined;
  let costMicroCents = 0;
  const reservationId = `mailbox-action:${run.id}:${run.attempts}`;
  try {
    const [revision] = await db
      .select({
        graph: mailboxActionRevision.graph,
        userId: mailboxActionRevision.createdByUserId,
      })
      .from(mailboxActionRevision)
      .where(eq(mailboxActionRevision.id, run.revisionId))
      .limit(1);
    if (revision === undefined || !revision.userId) {
      throw new Error("Action revision was not found.");
    }

    const revisionUserId = revision.userId;
    const validation = validateMailboxActionGraph(revision.graph);
    if (
      !validation.valid ||
      validation.graph === undefined ||
      validation.graph === null
    ) {
      throw new Error("Action revision graph is invalid.");
    }
    const { graph } = validation;
    const actor = {
      actionId: run.actionId,
      mailboxId: run.mailboxId,
      userId: revisionUserId,
    };
    const entitlement = await getActionExecutionEntitlement(actor);
    if (entitlement.account !== null && !entitlement.hasUnlimitedAccess) {
      await reserveAiCredits({
        account: entitlement.account,
        amountMicroCents: ACTION_ALLOWANCE_MICROCENTS,
        id: reservationId,
      });
    }
    const usageIndexesByStepRunId = new Map<string, number>();
    const createUsageReporter: MailboxActionUsageReporter = ({
      model,
      nodeId: _nodeId,
      stepRunId,
    }) => {
      const externalIdFor = (usageIndex: number) =>
        `mailbox-action:${run.id}:${stepRunId}:${usageIndex}`;
      return (usage) => {
        const usageIndex = usageIndexesByStepRunId.get(stepRunId) ?? 0;
        usageIndexesByStepRunId.set(stepRunId, usageIndex + 1);
        usageTasks.push(
          (async () => {
            try {
              costMicroCents += getAiUsageCostMicroCents(
                usage.costUsd ?? Number.NaN
              );
              await reportAiUsage({
                completionTokens: usage.completionTokens,
                costUsd: usage.costUsd,
                externalId: externalIdFor(usageIndex),
                mailboxId: run.mailboxId,
                model,
                promptTokens: usage.promptTokens,
                promptTokensDetails: {
                  cacheWriteTokens: usage.cacheWriteTokens,
                  cachedTokens: usage.cachedTokens,
                },
                usageKind: "aiChat",
                userId: revisionUserId,
              });
            } catch (error: unknown) {
              usageFailure =
                error instanceof Error
                  ? error
                  : new Error("Action usage could not be recorded.", {
                      cause: error,
                    });
              reportError(error, {
                operation: "mailbox-actions:report-ai-usage",
              });
            }
          })()
        );
      };
    };
    const email = await loadActionEmailInput({
      mailboxId: run.mailboxId,
      sourceMessageId: run.sourceMessageId,
    });
    const agentContext = await loadAiAgentContext({
      agent: "automation",
      includeUserScope: false,
      mailboxId: run.mailboxId,
      query: buildMailMemoryQuery(email),
      userId: revisionUserId,
    });
    const memoryContext = serializeAiAgentContext(agentContext);
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const triggerNode = nodesById.get(run.triggerNodeId);
    if (triggerNode === undefined) {
      throw new Error("Trigger node was not found.");
    }

    const queue: { frame: RuntimeFrame; node: MailboxActionNode }[] = [
      {
        frame: {
          branchPath: [triggerNode.id],
          previousOutputs: {},
          variables: {},
        },
        node: triggerNode,
      },
    ];
    let executedCount = 0;
    for (const item of queue) {
      signal.throwIfAborted();
      executedCount += 1;
      if (executedCount > MAX_NODE_EXECUTIONS) {
        throw new Error("Workflow exceeded the node execution limit.");
      }
      const step = await withMailboxActionRun(run, async (tx) => {
        const [completed] = await tx
          .select()
          .from(mailboxActionStepRun)
          .where(
            and(
              eq(mailboxActionStepRun.runId, run.id),
              eq(mailboxActionStepRun.status, "succeeded"),
              sql`${mailboxActionStepRun.input}->'branchPath' = ${JSON.stringify(item.frame.branchPath)}::jsonb`
            )
          )
          .orderBy(asc(mailboxActionStepRun.createdAt))
          .limit(1);
        if (completed !== undefined) {
          const stored = nodeResultSchema.safeParse(completed.executionResult);
          if (!stored.success) {
            throw new ORPCError("CONFLICT", {
              message:
                "An earlier action run needs review before it can resume.",
            });
          }
          return { id: completed.id, result: stored.data };
        }
        const now = new Date();
        const id = randomUUID();
        await tx.insert(mailboxActionStepRun).values({
          createdAt: now,
          id,
          input: {
            branchPath: item.frame.branchPath,
            email,
            nodeConfig: item.node.config,
            previousOutputs: item.frame.previousOutputs,
            variables: item.frame.variables,
          },
          nodeId: item.node.id,
          nodeType: item.node.type,
          runId: run.id,
          startedAt: now,
          status: "running",
          updatedAt: now,
        });
        return { id, result: null };
      });
      let { result } = step;
      if (result === null) {
        await getActionExecutionEntitlement(actor);
        if (
          costMicroCents >= ACTION_ALLOWANCE_MICROCENTS &&
          ["ai_condition", "ai_router", "connector_agent"].includes(
            item.node.type
          )
        ) {
          throw new ORPCError("FORBIDDEN", {
            message: "This action reached its per-run AI allowance.",
          });
        }
        const stepSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(CONNECTOR_STEP_BUDGET_MS),
        ]);
        result = await executeNode({
          actionId: run.actionId,
          attempts: run.attempts,
          email,
          frame: item.frame,
          memoryContext,
          node: item.node,
          revisionId: run.revisionId,
          runId: run.id,
          signal: stepSignal,
          stepRunId: step.id,
          usageReporter: createUsageReporter,
          userId: revisionUserId,
        });
        stepSignal.throwIfAborted();
        await Promise.all(usageTasks);
        if (usageFailure !== undefined) {
          throw new ORPCError("CONFLICT", {
            cause: usageFailure,
            message:
              "Usage could not be recorded. This action needs review before it can resume.",
          });
        }
        const savedResult = result;
        await withMailboxActionRun(run, async (tx) => {
          const now = new Date();
          await tx
            .update(mailboxActionStepRun)
            .set({
              completedAt: now,
              executionResult: savedResult,
              output: savedResult.output,
              status: "succeeded",
              updatedAt: now,
            })
            .where(eq(mailboxActionStepRun.id, step.id));
        });
      }
      const variables = { ...item.frame.variables, ...result.variables };
      const previousOutputs = {
        ...item.frame.previousOutputs,
        [item.node.id]: result.output,
      };
      for (const edge of graph.edges) {
        if (
          edge.source !== item.node.id ||
          !result.outputPorts.includes(edge.sourcePort)
        ) {
          continue;
        }
        const node = nodesById.get(edge.target);
        if (node === undefined) {
          throw new Error("Action target node was not found.");
        }
        queue.push({
          frame: {
            branchPath: [...item.frame.branchPath, edge.id, node.id],
            previousOutputs,
            variables,
          },
          node,
        });
      }
    }
    signal.throwIfAborted();
    const completedAt = new Date();
    const [completed] = await db
      .update(mailboxActionRun)
      .set({
        completedAt,
        leasedUntil: null,
        status: executedCount === 1 ? "skipped" : "succeeded",
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(mailboxActionRun.id, run.id),
          eq(mailboxActionRun.attempts, run.attempts),
          eq(mailboxActionRun.status, "running"),
          gt(mailboxActionRun.leasedUntil, new Date())
        )
      )
      .returning({ id: mailboxActionRun.id });
    if (completed === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "This action is no longer owned by this worker.",
      });
    }
    return { status: "succeeded" as const };
  } catch (error) {
    await db
      .update(mailboxActionRun)
      .set(
        mailboxActionFailureUpdate(error, {
          finalAttempt: options?.finalAttempt === true || run.attempts >= 6,
        })
      )
      .where(
        and(
          eq(mailboxActionRun.id, run.id),
          eq(mailboxActionRun.attempts, run.attempts),
          eq(mailboxActionRun.status, "running"),
          gt(mailboxActionRun.leasedUntil, new Date())
        )
      );
    throw error;
  } finally {
    await Promise.all(usageTasks);
    await db
      .delete(billingCreditReservation)
      .where(eq(billingCreditReservation.id, reservationId));
  }
};
