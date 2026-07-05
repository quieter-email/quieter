import { z } from "zod";

export const MAILBOX_ACTION_GRAPH_VERSION = 1 as const;

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const emailReceivedConfigSchema = z.object({}).default({});
const aiConditionConfigSchema = z.object({
  criteria: z.string().trim().min(1).max(4_000),
});
const aiRouterConfigSchema = z.object({
  fallbackPort: z.string().trim().min(1).default("fallback"),
  instructions: z.string().trim().min(1).max(4_000),
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
const linearBaseConfigSchema = z.object({
  assigneeId: z.string().trim().min(1).optional(),
  credentialId: z.string().trim().min(1).optional(),
  labelIds: z.array(z.string().trim().min(1)).max(12).optional(),
  priority: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional(),
  projectId: z.string().trim().min(1).optional(),
  stateId: z.string().trim().min(1).optional(),
  teamId: z.string().trim().min(1).optional(),
});
const linearCreateIssueConfigSchema = linearBaseConfigSchema.extend({
  description: z.string().trim().max(12_000).optional(),
  title: z.string().trim().min(1).max(255).optional(),
});
const linearAgentIssueConfigSchema = linearBaseConfigSchema.extend({
  instructions: z.string().trim().max(4_000).optional(),
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
    config: linearCreateIssueConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("linear_create_issue"),
  }),
  z.object({
    config: linearAgentIssueConfigSchema,
    id: z.string().trim().min(1),
    position: positionSchema,
    type: z.literal("linear_agent_issue"),
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

export const getMailboxActionOutputPorts = (node: MailboxActionNode): string[] => {
  switch (node.type) {
    case "email_received":
    case "merge":
    case "set_variable":
      return ["out"];
    case "ai_condition":
      return ["yes", "no"];
    case "ai_router":
      return [...new Set([...node.config.ports, node.config.fallbackPort])];
    case "linear_agent_issue":
    case "linear_create_issue":
      return ["success"];
    case "stop":
      return [];
  }
};

export const getMailboxActionInputPorts = (node: MailboxActionNode): string[] =>
  node.type === "email_received" ? [] : ["in"];

const detectCycle = (graph: MailboxActionGraph) => {
  const edgesBySource = new Map<string, string[]>();
  for (const edge of graph.edges) {
    edgesBySource.set(edge.source, [...(edgesBySource.get(edge.source) ?? []), edge.target]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const target of edgesBySource.get(nodeId) ?? []) {
      if (visit(target)) return true;
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
    edgesBySource.set(edge.source, [...(edgesBySource.get(edge.source) ?? []), edge.target]);
  }

  const reachable = new Set<string>();
  const queue = graph.nodes.filter((node) => node.type === "email_received").map((node) => node.id);
  for (const nodeId of queue) {
    reachable.add(nodeId);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) break;
    for (const targetId of edgesBySource.get(nodeId) ?? []) {
      if (reachable.has(targetId)) continue;
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
    addIssue({ message: "Workflow needs at least one email received trigger." });
  }

  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source) {
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
    if (node.type !== "linear_agent_issue" && node.type !== "linear_create_issue") continue;
    if (!node.config.credentialId) {
      addIssue({
        message: `Linear node ${node.id} needs a connected Linear account.`,
        nodeId: node.id,
      });
    }
    if (!node.config.teamId) {
      addIssue({
        message: `Linear node ${node.id} needs a target Linear team.`,
        nodeId: node.id,
      });
    }
    if (node.type === "linear_create_issue" && !node.config.title) {
      addIssue({ message: `Linear issue node ${node.id} needs a title.`, nodeId: node.id });
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
      id: "edge-trigger-linear",
      source: "trigger",
      sourcePort: "out",
      target: "linear",
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
      config: {
        instructions: "Create a useful Linear issue when this email describes work to track.",
      },
      id: "linear",
      position: { x: 360, y: 120 },
      type: "linear_agent_issue",
    },
  ],
  version: MAILBOX_ACTION_GRAPH_VERSION,
});
