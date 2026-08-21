import { z } from "zod";

import { connectorProviderSchema } from "../connectors/contracts";
import { hasText } from "../text";

export const MAILBOX_ACTION_GRAPH_VERSION = 1 as const;

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const emailReceivedConfigSchema = z.object({}).default({});
const aiConditionConfigSchema = z.object({
  criteria: z.string().trim().min(1).max(4000),
});
const aiRouterConfigSchema = z.object({
  fallbackPort: z.string().trim().min(1).default("fallback"),
  instructions: z.string().trim().min(1).max(4000),
  ports: z.array(z.string().trim().min(1)).min(1).max(20),
});
const setVariableConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.unknown(),
});
const mergeConfigSchema = z.object({
  mode: z.enum(["wait_all", "pass_through"]).default("wait_all"),
});
const stopConfigSchema = z.object({}).default({});
/**
 * A connector step names the app and the account, and carries the instruction
 * in prose. Anything a specific connector needs beyond that, such as which team
 * to file under, is discovered from its own tools while the action runs.
 */
const connectorAgentConfigSchema = z.object({
  credentialId: z.string().trim().min(1).optional(),
  instructions: z.string().trim().max(4000).optional(),
  provider: connectorProviderSchema.optional(),
});

export const mailboxActionNodeSchema = z.discriminatedUnion("type", [
  z.object({
    config: emailReceivedConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("email_received"),
  }),
  z.object({
    config: aiConditionConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("ai_condition"),
  }),
  z.object({
    config: aiRouterConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("ai_router"),
  }),
  z.object({
    config: setVariableConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("set_variable"),
  }),
  z.object({
    config: mergeConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("merge"),
  }),
  z.object({
    config: stopConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("stop"),
  }),
  z.object({
    config: connectorAgentConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("connector_agent"),
  }),
]);

export const mailboxActionEdgeSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().max(80).optional(),
  source: z.string().trim().min(1),
  sourcePort: z.string().trim().min(1),
  target: z.string().trim().min(1),
  targetPort: z.string().trim().min(1),
});

export const mailboxActionGraphSchema = z.object({
  edges: z.array(mailboxActionEdgeSchema).max(500),
  nodes: z.array(mailboxActionNodeSchema).min(1).max(500),
  version: z.literal(MAILBOX_ACTION_GRAPH_VERSION),
});

export type MailboxActionGraph = z.infer<typeof mailboxActionGraphSchema>;
export type MailboxActionNode = z.infer<typeof mailboxActionNodeSchema>;
export type MailboxActionEdge = z.infer<typeof mailboxActionEdgeSchema>;
export type MailboxActionValidationIssue = {
  edgeId?: string;
  message: string;
  nodeId?: string;
};

export const getMailboxActionOutputPorts = (
  node: MailboxActionNode
): string[] => {
  switch (node.type) {
    case "email_received":
    case "merge":
    case "set_variable": {
      return ["out"];
    }
    case "ai_condition": {
      return ["yes", "no"];
    }
    case "ai_router": {
      return [...new Set([...node.config.ports, node.config.fallbackPort])];
    }
    case "connector_agent": {
      return ["success"];
    }
    case "stop": {
      return [];
    }
    default: {
      return [];
    }
  }
};

export const getMailboxActionInputPorts = (
  node: MailboxActionNode
): string[] => (node.type === "email_received" ? [] : ["in"]);

const detectCycle = (graph: MailboxActionGraph) => {
  const edgesBySource = new Map<string, string[]>();
  for (const edge of graph.edges) {
    edgesBySource.set(edge.source, [
      ...(edgesBySource.get(edge.source) ?? []),
      edge.target,
    ]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const target of edgesBySource.get(nodeId) ?? []) {
      if (visit(target)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return graph.nodes.some((node) => visit(node.id));
};

const getReachableNodeIds = (graph: MailboxActionGraph) => {
  const edgesBySource = new Map<string, string[]>();
  for (const edge of graph.edges) {
    edgesBySource.set(edge.source, [
      ...(edgesBySource.get(edge.source) ?? []),
      edge.target,
    ]);
  }

  const reachable = new Set<string>();
  const queue = graph.nodes
    .filter((node) => node.type === "email_received")
    .map((node) => node.id);
  for (const nodeId of queue) {
    reachable.add(nodeId);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (nodeId === undefined || nodeId === "") {
      break;
    }
    for (const targetId of edgesBySource.get(nodeId) ?? []) {
      if (reachable.has(targetId)) {
        continue;
      }
      reachable.add(targetId);
      queue.push(targetId);
    }
  }

  return reachable;
};

export const validateMailboxActionGraph = (graphInput: unknown) => {
  const parsed = mailboxActionGraphSchema.safeParse(graphInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      message: issue.message,
    }));
    return {
      errors: issues.map((issue) => issue.message),
      graph: null,
      issues,
      valid: false,
    } as const;
  }

  const graph = parsed.data;
  const issues: MailboxActionValidationIssue[] = [];
  const addIssue = (issue: MailboxActionValidationIssue) => issues.push(issue);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  if (nodesById.size !== graph.nodes.length) {
    addIssue({ message: "Node ids must be unique." });
  }
  if (!graph.nodes.some((node) => node.type === "email_received")) {
    addIssue({
      message: "Workflow needs at least one email received trigger.",
    });
  }

  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (source === undefined) {
      addIssue({
        edgeId: edge.id,
        message: `Edge ${edge.id} references a missing source node.`,
        nodeId: edge.source,
      });
      continue;
    }
    if (!target) {
      addIssue({
        edgeId: edge.id,
        message: `Edge ${edge.id} references a missing target node.`,
        nodeId: edge.target,
      });
      continue;
    }
    if (!getMailboxActionOutputPorts(source).includes(edge.sourcePort)) {
      addIssue({
        edgeId: edge.id,
        message: `Edge ${edge.id} uses an invalid source port.`,
        nodeId: source.id,
      });
    }
    if (!getMailboxActionInputPorts(target).includes(edge.targetPort)) {
      addIssue({
        edgeId: edge.id,
        message: `Edge ${edge.id} uses an invalid target port.`,
        nodeId: target.id,
      });
    }
  }

  if (detectCycle(graph)) {
    addIssue({ message: "Workflow loops are not supported yet." });
  }
  const reachableNodeIds = getReachableNodeIds(graph);
  for (const node of graph.nodes) {
    if (!reachableNodeIds.has(node.id)) {
      addIssue({ message: `Node ${node.id} is unreachable.`, nodeId: node.id });
    }
  }
  for (const node of graph.nodes) {
    if (node.type !== "connector_agent") {
      continue;
    }
    if (node.config.provider === undefined) {
      addIssue({
        message: `Step ${node.id} needs a connected app.`,
        nodeId: node.id,
      });
    }
    if (!hasText(node.config.credentialId)) {
      addIssue({
        message: `Step ${node.id} needs a connected account.`,
        nodeId: node.id,
      });
    }
    if (!hasText(node.config.instructions)) {
      addIssue({
        message: `Step ${node.id} needs an instruction.`,
        nodeId: node.id,
      });
    }
  }

  return {
    errors: issues.map((issue) => issue.message),
    graph,
    issues,
    valid: issues.length === 0,
  } as const;
};

export const createDefaultMailboxActionGraph = (): MailboxActionGraph => ({
  edges: [
    {
      id: "edge-trigger-connector",
      source: "trigger",
      sourcePort: "out",
      target: "connector",
      targetPort: "in",
    },
  ],
  nodes: [
    {
      config: {},
      id: "trigger",
      position: { x: 0, y: 120 },
      type: "email_received",
    },
    {
      config: {},
      id: "connector",
      position: { x: 360, y: 120 },
      type: "connector_agent",
    },
  ],
  version: MAILBOX_ACTION_GRAPH_VERSION,
});
