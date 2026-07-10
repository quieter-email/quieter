import { describe, expect, test } from "vite-plus/test";
import {
  createDefaultMailboxActionGraph,
  type MailboxActionEdge,
  type MailboxActionGraph,
  type MailboxActionNode,
  validateMailboxActionGraph,
} from "./graph";

const position = { x: 0, y: 0 };

const trigger = (id = "trigger"): MailboxActionNode => ({
  config: {},
  id,
  position,
  type: "email_received",
});

const stop = (id = "stop"): MailboxActionNode => ({
  config: {},
  id,
  position,
  type: "stop",
});

const condition = (id: string): MailboxActionNode => ({
  config: { criteria: "The email describes product work." },
  id,
  position,
  type: "ai_condition",
});

const variable = (id: string, value = "value"): MailboxActionNode => ({
  config: { name: id, value },
  id,
  position,
  type: "set_variable",
});

const edge = (
  id: string,
  source: string,
  sourcePort: string,
  target: string,
): MailboxActionEdge => ({
  id,
  source,
  sourcePort,
  target,
  targetPort: "in",
});

const graph = (nodes: MailboxActionNode[], edges: MailboxActionEdge[]): MailboxActionGraph => ({
  edges,
  nodes,
  version: 1,
});

describe("validateMailboxActionGraph", () => {
  test("accepts a direct trigger to deterministic Linear issue action", () => {
    const result = validateMailboxActionGraph(
      graph(
        [
          trigger(),
          {
            config: {
              credentialId: "linear-credential",
              teamId: "team-id",
              title: "{{email.subject}}",
            },
            id: "linear",
            position,
            type: "linear_create_issue",
          },
        ],
        [edge("trigger-linear", "trigger", "out", "linear")],
      ),
    );

    expect(result.valid).toBe(true);
  });

  test("accepts a chain of twenty AI conditions", () => {
    const conditions = Array.from({ length: 20 }, (_item, index) =>
      condition(`condition-${index}`),
    );
    const nodes = [trigger(), ...conditions, stop()];
    const edges = [
      edge("trigger-condition-0", "trigger", "out", "condition-0"),
      ...conditions
        .slice(0, -1)
        .map((node, index) =>
          edge(
            `condition-${index}-condition-${index + 1}`,
            node.id,
            "yes",
            `condition-${index + 1}`,
          ),
        ),
      edge("condition-19-stop", "condition-19", "yes", "stop"),
    ];

    expect(validateMailboxActionGraph(graph(nodes, edges)).valid).toBe(true);
  });

  test("accepts routers, split branches, variables, and merge nodes", () => {
    const result = validateMailboxActionGraph(
      graph(
        [
          trigger(),
          {
            config: {
              fallbackPort: "other",
              instructions: "Route into bug, feature, or other.",
              ports: ["bug", "feature", "other"],
            },
            id: "router",
            position,
            type: "ai_router",
          },
          variable("bug", "bug"),
          variable("feature", "feature"),
          {
            config: { mode: "wait_all" },
            id: "merge",
            position,
            type: "merge",
          },
          stop(),
        ],
        [
          edge("trigger-router", "trigger", "out", "router"),
          edge("router-bug", "router", "bug", "bug"),
          edge("router-feature", "router", "feature", "feature"),
          edge("bug-merge", "bug", "out", "merge"),
          edge("feature-merge", "feature", "out", "merge"),
          edge("merge-stop", "merge", "out", "stop"),
        ],
      ),
    );

    expect(result.valid).toBe(true);
  });

  test("rejects invalid ports", () => {
    const result = validateMailboxActionGraph(
      graph([trigger(), stop()], [edge("bad-port", "trigger", "missing", "stop")]),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Edge bad-port uses an invalid source port.");
    expect(result.issues).toContainEqual({
      edgeId: "bad-port",
      message: "Edge bad-port uses an invalid source port.",
      nodeId: "trigger",
    });
  });

  test("rejects unreachable nodes", () => {
    const result = validateMailboxActionGraph(
      graph(
        [trigger(), stop(), variable("orphan")],
        [edge("trigger-stop", "trigger", "out", "stop")],
      ),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Node orphan is unreachable.");
  });

  test("rejects cycles", () => {
    const result = validateMailboxActionGraph(
      graph(
        [trigger(), condition("condition"), variable("loop")],
        [
          edge("trigger-condition", "trigger", "out", "condition"),
          edge("condition-loop", "condition", "yes", "loop"),
          edge("loop-condition", "loop", "out", "condition"),
        ],
      ),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow loops are not supported yet.");
  });

  test("keeps the default graph parseable while semantically incomplete", () => {
    const result = validateMailboxActionGraph(createDefaultMailboxActionGraph());

    expect(result.graph).not.toBeNull();
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Linear node linear needs a connected Linear account.");
    expect(result.errors).toContain("Linear node linear needs a target Linear team.");
  });
});
