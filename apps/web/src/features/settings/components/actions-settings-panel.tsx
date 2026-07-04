"use client";

import "@xyflow/react/dist/style.css";
import type { TextareaHTMLAttributes } from "react";
import {
  Add01Icon,
  CheckmarkCircle01Icon,
  CodeIcon,
  ConnectIcon,
  Loading03Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Input } from "@quieter/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { connectorsQueryOptions, openConnectorLink } from "~/lib/connectors-query";
import {
  linearMetadataQueryOptions,
  mailboxActionQueryKey,
  mailboxActionQueryOptions,
  mailboxActionsListQueryKey,
  mailboxActionsListQueryOptions,
} from "~/lib/mailbox-actions-query";
import { mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

type NodePosition = {
  x: number;
  y: number;
};

type EmailReceivedNode = {
  config: Record<string, never>;
  id: string;
  position: NodePosition;
  type: "email_received";
};

type AiConditionNode = {
  config: {
    criteria: string;
  };
  id: string;
  position: NodePosition;
  type: "ai_condition";
};

type AiRouterNode = {
  config: {
    fallbackPort: string;
    instructions: string;
    ports: string[];
  };
  id: string;
  position: NodePosition;
  type: "ai_router";
};

type SetVariableNode = {
  config: {
    name: string;
    value: string;
  };
  id: string;
  position: NodePosition;
  type: "set_variable";
};

type MergeNode = {
  config: {
    mode: "pass_through" | "wait_all";
  };
  id: string;
  position: NodePosition;
  type: "merge";
};

type StopNode = {
  config: Record<string, never>;
  id: string;
  position: NodePosition;
  type: "stop";
};

type LinearCreateIssueNode = {
  config: {
    assigneeId?: string;
    credentialId?: string;
    description?: string;
    labelIds?: string[];
    priority?: 0 | 1 | 2 | 3 | 4;
    projectId?: string;
    stateId?: string;
    teamId?: string;
    title?: string;
  };
  id: string;
  position: NodePosition;
  type: "linear_create_issue";
};

type LinearAgentIssueNode = {
  config: {
    credentialId?: string;
    instructions: string;
    teamId?: string;
  };
  id: string;
  position: NodePosition;
  type: "linear_agent_issue";
};

type MailboxActionNode =
  | EmailReceivedNode
  | AiConditionNode
  | AiRouterNode
  | SetVariableNode
  | MergeNode
  | StopNode
  | LinearCreateIssueNode
  | LinearAgentIssueNode;

type MailboxActionEdge = {
  id: string;
  label?: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
};

type MailboxActionGraph = {
  edges: MailboxActionEdge[];
  nodes: MailboxActionNode[];
  version: 1;
};

type ActionFlowNodeData = {
  actionNode: MailboxActionNode;
  invalid: boolean;
  subtitle: string;
  title: string;
};

type ActionFlowNode = Node<ActionFlowNodeData, "action">;

type MailboxOption = {
  emailAddress: string;
  groupName: string;
  id: string;
  label: string;
  provider: string;
};

const NODE_TITLES = {
  ai_condition: "Condition",
  ai_router: "Router",
  email_received: "Email received",
  linear_agent_issue: "Linear agent",
  linear_create_issue: "Linear issue",
  merge: "Merge",
  set_variable: "Variable",
  stop: "Stop",
} as const satisfies Record<MailboxActionNode["type"], string>;

const NODE_SUBTITLES = {
  ai_condition: "AI decides yes or no",
  ai_router: "AI chooses one output",
  email_received: "Incoming mailbox message",
  linear_agent_issue: "Research and create",
  linear_create_issue: "Exact mapped inputs",
  merge: "Combine branches",
  set_variable: "Store path data",
  stop: "End this path",
} as const satisfies Record<MailboxActionNode["type"], string>;

const PALETTE: Array<{
  icon: typeof CodeIcon;
  label: string;
  type: Exclude<MailboxActionNode["type"], "email_received">;
}> = [
  { icon: CodeIcon, label: "Condition", type: "ai_condition" },
  { icon: ConnectIcon, label: "Router", type: "ai_router" },
  { icon: CodeIcon, label: "Variable", type: "set_variable" },
  { icon: ConnectIcon, label: "Merge", type: "merge" },
  { icon: ConnectIcon, label: "Linear agent", type: "linear_agent_issue" },
  { icon: ConnectIcon, label: "Linear exact", type: "linear_create_issue" },
  { icon: CodeIcon, label: "Stop", type: "stop" },
];

const createClientId = (prefix: string) => {
  const id =
    "crypto" in globalThis && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${id}`;
};

const createEmptyGraph = (): MailboxActionGraph => ({
  edges: [
    {
      id: createClientId("edge"),
      label: "out",
      source: "trigger",
      sourcePort: "out",
      target: "linear_agent",
      targetPort: "in",
    },
  ],
  nodes: [
    {
      config: {},
      id: "trigger",
      position: { x: 40, y: 180 },
      type: "email_received",
    },
    {
      config: {
        instructions:
          "Create a concise Linear issue when this email is a bug report or feature request. Research related issues, use matching labels, and include evidence from the message.",
      },
      id: "linear_agent",
      position: { x: 430, y: 160 },
      type: "linear_agent_issue",
    },
  ],
  version: 1,
});

const toEditorGraph = (value: unknown): MailboxActionGraph => {
  if (!value || typeof value !== "object") {
    return createEmptyGraph();
  }

  const graph = value as Partial<MailboxActionGraph>;
  return {
    edges: Array.isArray(graph.edges) ? graph.edges : [],
    nodes: Array.isArray(graph.nodes) ? graph.nodes : createEmptyGraph().nodes,
    version: 1,
  };
};

const getOutputPorts = (node: MailboxActionNode) => {
  switch (node.type) {
    case "email_received":
    case "set_variable":
    case "merge":
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

const createNode = (
  type: Exclude<MailboxActionNode["type"], "email_received">,
  position: NodePosition,
): MailboxActionNode => {
  const id = createClientId(type);
  switch (type) {
    case "ai_condition":
      return {
        config: { criteria: "The email is a bug report or feature request." },
        id,
        position,
        type,
      };
    case "ai_router":
      return {
        config: {
          fallbackPort: "other",
          instructions: "Route support mail into bug, feature, or other.",
          ports: ["bug", "feature", "other"],
        },
        id,
        position,
        type,
      };
    case "linear_agent_issue":
      return {
        config: {
          instructions:
            "Research similar Linear issues, infer the right labels and status, then create one clear issue.",
        },
        id,
        position,
        type,
      };
    case "linear_create_issue":
      return {
        config: {
          description: "{{email.bodyText}}",
          title: "{{email.subject}}",
        },
        id,
        position,
        type,
      };
    case "merge":
      return { config: { mode: "pass_through" }, id, position, type };
    case "set_variable":
      return { config: { name: "mail_category", value: "support" }, id, position, type };
    case "stop":
      return { config: {}, id, position, type };
  }
};

const getNodeIssueCount = (nodeId: string, errors: string[]) =>
  errors.filter((error) => error.includes(nodeId)).length;

const ActionNodeCard = ({ data, selected }: NodeProps<ActionFlowNode>) => {
  const outputPorts = getOutputPorts(data.actionNode);
  const targetVisible = data.actionNode.type !== "email_received";

  return (
    <div
      className={cn(
        "relative min-w-55 rounded-lg border bg-[#141414]/95 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.25)] backdrop-blur-sm",
        {
          "border-destructive/70": data.invalid,
          "border-primary/70 ring-2 ring-primary/20": selected,
          "border-white/10": !selected && !data.invalid,
        },
      )}
    >
      {targetVisible ? (
        <Handle
          className="size-3! border! border-white/20! bg-[#1f1f1f]!"
          id="in"
          position={Position.Left}
          type="target"
        />
      ) : null}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border text-foreground",
            {
              "border-[#5e6ad2]/50 bg-[#5e6ad2]/20":
                data.actionNode.type === "linear_agent_issue" ||
                data.actionNode.type === "linear_create_issue",
              "border-white/10 bg-white/5":
                data.actionNode.type !== "linear_agent_issue" &&
                data.actionNode.type !== "linear_create_issue",
            },
          )}
        >
          <HugeiconsIcon
            aria-hidden
            className="size-4"
            icon={data.actionNode.type === "email_received" ? Mail01Icon : ConnectIcon}
          />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{data.title}</div>
          <div className="truncate text-xs text-muted-foreground">{data.subtitle}</div>
        </div>
      </div>
      {outputPorts.map((port, index) => (
        <Handle
          className="size-3! border! border-[#5e6ad2]/50! bg-[#5e6ad2]!"
          id={port}
          key={port}
          position={Position.Right}
          style={{ top: `${((index + 1) / (outputPorts.length + 1)) * 100}%` }}
          type="source"
        />
      ))}
      {outputPorts.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {outputPorts.map((port) => (
            <span
              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground"
              key={port}
            >
              {port}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const nodeTypes = {
  action: ActionNodeCard,
};

const FieldLabel = ({ children }: { children: string }) => (
  <label className="text-xs font-medium text-muted-foreground">{children}</label>
);

const MentionChip = () => (
  <span className="rounded-full border border-[#5e6ad2]/40 bg-[#5e6ad2]/15 px-2 py-0.5 text-[11px] font-medium text-[#b8bef8]">
    @Linear
  </span>
);

const PanelTextarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cn(
      "min-h-24 w-full resize-none rounded-md border border-input bg-background-light px-3 py-2 text-sm text-foreground outline-none squircle placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export const ActionsSettingsPanel = () => {
  const queryClient = useQueryClient();
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>();
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState("linear_agent");
  const [graph, setGraph] = useState<MailboxActionGraph>(() => createEmptyGraph());
  const [workflowName, setWorkflowName] = useState("New action");
  const [startingLinear, setStartingLinear] = useState(false);

  const { data: mailboxesData, isLoading: mailboxesLoading } = useQuery(mailboxesQueryOptions());
  const { data: connectorsData } = useQuery(connectorsQueryOptions());
  const mailboxOptions = useMemo<MailboxOption[]>(
    () =>
      (mailboxesData?.groups ?? []).flatMap((group) =>
        group.mailboxes
          .filter((mailbox) => mailbox.provider === "gmail" || mailbox.provider === "managed")
          .map((mailbox) => ({
            emailAddress: mailbox.emailAddress,
            groupName: group.name,
            id: mailbox.id,
            label: mailbox.displayName || mailbox.emailAddress,
            provider: mailbox.provider,
          })),
      ),
    [mailboxesData],
  );
  const activeMailboxId = selectedMailboxId ?? mailboxOptions[0]?.id;
  const activeMailbox = mailboxOptions.find((mailbox) => mailbox.id === activeMailboxId);
  const actionsQuery = useQuery(mailboxActionsListQueryOptions(activeMailboxId));
  const actions = actionsQuery.data?.actions ?? [];
  const activeActionId = actions.some((action) => action.id === selectedActionId)
    ? selectedActionId
    : actions[0]?.id;
  const actionQuery = useQuery(mailboxActionQueryOptions(activeActionId));
  const action = actionQuery.data?.action;
  const draftRevision =
    actionQuery.data?.revisions.find((revision) => revision.id === action?.draftRevisionId) ??
    actionQuery.data?.revisions[0];
  const validationErrors = draftRevision?.validationErrors ?? [];
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0] ?? null;
  const linearConnector = connectorsData?.connectors.find(
    (connector) => connector.provider === "linear",
  );
  const linearAccounts =
    linearConnector?.accounts.filter((account) => account.status === "connected") ?? [];
  const selectedCredentialId =
    selectedNode?.type === "linear_agent_issue" || selectedNode?.type === "linear_create_issue"
      ? selectedNode.config.credentialId
      : undefined;
  const linearMetadataQuery = useQuery(linearMetadataQueryOptions(selectedCredentialId));

  useEffect(() => {
    if (!draftRevision || !action) {
      return;
    }
    setGraph(toEditorGraph(draftRevision.graph));
    setWorkflowName(action.name);
    const firstNodeId = toEditorGraph(draftRevision.graph).nodes[0]?.id;
    if (firstNodeId) setSelectedNodeId(firstNodeId);
  }, [action?.id, draftRevision?.id]);

  const invalidateActionQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: mailboxActionsListQueryKey(activeMailboxId) }),
      queryClient.invalidateQueries({ queryKey: mailboxActionQueryKey(activeActionId) }),
    ]);
  };

  const createActionMutation = useMutation({
    ...orpc.mailboxActions.create.mutationOptions(),
    onSuccess: async (result) => {
      setSelectedActionId(result.actionId);
      await queryClient.invalidateQueries({
        queryKey: mailboxActionsListQueryKey(activeMailboxId),
      });
    },
  });
  const saveDraftMutation = useMutation({
    ...orpc.mailboxActions.saveDraft.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateActionQueries();
      if (result.validationStatus === "valid") {
        toast.success("Action saved.");
      } else {
        toast.warning("Action saved with validation issues.");
      }
    },
  });
  const publishMutation = useMutation({
    ...orpc.mailboxActions.publish.mutationOptions(),
    onSuccess: async () => {
      await invalidateActionQueries();
      toast.success("Action published.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not publish action.");
    },
  });
  const setEnabledMutation = useMutation({
    ...orpc.mailboxActions.setEnabled.mutationOptions(),
    onSuccess: async () => {
      await invalidateActionQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not update action.");
    },
  });

  const updateNode = (nodeId: string, updater: (node: MailboxActionNode) => MailboxActionNode) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
    }));
  };

  const addNode = (type: Exclude<MailboxActionNode["type"], "email_received">) => {
    const selected = selectedNode;
    const nextPosition = selected
      ? { x: selected.position.x + 360, y: selected.position.y + 40 }
      : { x: 120, y: 120 };
    const node = createNode(type, nextPosition);
    setGraph((current) => {
      const source =
        selected && current.nodes.some((item) => item.id === selected.id) ? selected : null;
      const sourcePort = source ? getOutputPorts(source)[0] : null;
      return {
        ...current,
        edges:
          source && sourcePort
            ? [
                ...current.edges,
                {
                  id: createClientId("edge"),
                  label: sourcePort,
                  source: source.id,
                  sourcePort,
                  target: node.id,
                  targetPort: "in",
                },
              ]
            : current.edges,
        nodes: [...current.nodes, node],
      };
    });
    setSelectedNodeId(node.id);
  };

  const connectNodes = (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }
    const sourcePort = connection.sourceHandle ?? "out";
    setGraph((current) => ({
      ...current,
      edges: [
        ...current.edges.filter(
          (edge) =>
            !(
              edge.source === connection.source &&
              edge.sourcePort === sourcePort &&
              edge.target === connection.target
            ),
        ),
        {
          id: createClientId("edge"),
          label: sourcePort,
          source: connection.source,
          sourcePort,
          target: connection.target,
          targetPort: connection.targetHandle ?? "in",
        },
      ],
    }));
  };

  const flowNodes = useMemo<ActionFlowNode[]>(
    () =>
      graph.nodes.map((node) => ({
        data: {
          actionNode: node,
          invalid: getNodeIssueCount(node.id, validationErrors) > 0,
          subtitle: NODE_SUBTITLES[node.type],
          title: NODE_TITLES[node.type],
        },
        id: node.id,
        position: node.position,
        selected: node.id === selectedNode?.id,
        type: "action",
      })),
    [graph.nodes, selectedNode?.id, validationErrors],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        animated: edge.sourcePort === "success",
        id: edge.id,
        label: edge.label ?? edge.sourcePort,
        labelBgBorderRadius: 8,
        labelBgPadding: [6, 3],
        labelStyle: { fill: "#d6d6d6", fontSize: 11 },
        source: edge.source,
        sourceHandle: edge.sourcePort,
        style: { stroke: "#5e6ad2", strokeWidth: 1.5 },
        target: edge.target,
        targetHandle: edge.targetPort,
        type: "smoothstep",
      })),
    [graph.edges],
  );

  const saveDraft = () => {
    if (!activeActionId) return;
    saveDraftMutation.mutate({
      actionId: activeActionId,
      graph,
      name: workflowName,
    });
  };

  const startLinearConnection = async () => {
    setStartingLinear(true);
    try {
      await openConnectorLink({ provider: "linear", returnTo: "/settings?tab=actions" });
    } catch (error) {
      setStartingLinear(false);
      toast.error(error instanceof Error ? error.message : "Could not start Linear setup.");
    }
  };

  return (
    <div className="min-h-[calc(100dvh-9rem)] overflow-hidden rounded-lg border border-white/10 bg-[#0f0f0f]/92 shadow-2xl">
      <div className="flex min-h-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <HugeiconsIcon aria-hidden className="size-4" icon={ConnectIcon} />
            </div>
            <div className="min-w-0">
              <Input
                aria-label="Workflow name"
                chrome="ghost"
                className="h-7 px-0 text-base font-medium"
                onChange={(event) => setWorkflowName(event.target.value)}
                value={workflowName}
              />
              <p className="truncate text-xs text-muted-foreground">
                {activeMailbox ? `${activeMailbox.label} / ${activeMailbox.groupName}` : "Actions"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!activeActionId || saveDraftMutation.isPending}
              onClick={saveDraft}
              size="sm"
              type="button"
              variant="outline"
            >
              {saveDraftMutation.isPending ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : null}
              Save
            </Button>
            <Button
              disabled={!activeActionId || publishMutation.isPending}
              onClick={() => activeActionId && publishMutation.mutate({ actionId: activeActionId })}
              size="sm"
              type="button"
            >
              {publishMutation.isPending ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle01Icon} />
              )}
              Publish
            </Button>
            <Switch
              aria-label="Enable action"
              checked={action?.enabled ?? false}
              className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/10 p-0.5 data-checked:border-primary data-checked:bg-primary"
              disabled={
                !activeActionId || !action?.publishedRevisionId || setEnabledMutation.isPending
              }
              onCheckedChange={(enabled) =>
                activeActionId && setEnabledMutation.mutate({ actionId: activeActionId, enabled })
              }
            >
              <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
            </Switch>
          </div>
        </header>

        <div className="grid min-h-[calc(100dvh-14rem)] grid-cols-[260px_minmax(0,1fr)_320px] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-black/15 p-3">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <FieldLabel>Mailbox</FieldLabel>
                <Select
                  items={mailboxOptions.map((mailbox) => ({
                    label: mailbox.label,
                    value: mailbox.id,
                  }))}
                  onValueChange={(value) => {
                    if (!value) return;
                    setSelectedMailboxId(value);
                    setSelectedActionId(undefined);
                  }}
                  value={activeMailboxId ?? ""}
                >
                  <SelectTrigger
                    disabled={mailboxesLoading || mailboxOptions.length === 0}
                    size="sm"
                  >
                    <SelectValue placeholder="Select mailbox" />
                  </SelectTrigger>
                  <SelectContent>
                    {mailboxOptions.map((mailbox) => (
                      <SelectItem key={mailbox.id} value={mailbox.id}>
                        {mailbox.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <FieldLabel>Workflows</FieldLabel>
                  <Button
                    aria-label="Create action"
                    disabled={!activeMailboxId || createActionMutation.isPending}
                    onClick={() =>
                      activeMailboxId &&
                      createActionMutation.mutate({
                        mailboxId: activeMailboxId,
                        name: "Linear triage",
                      })
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
                  </Button>
                </div>
                <div className="space-y-1">
                  {actions.map((item) => (
                    <button
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors squircle",
                        {
                          "border-primary/60 bg-primary/10 text-foreground":
                            item.id === activeActionId,
                          "border-white/10 bg-white/3 text-muted-foreground hover:bg-white/6":
                            item.id !== activeActionId,
                        },
                      )}
                      key={item.id}
                      onClick={() => setSelectedActionId(item.id)}
                      type="button"
                    >
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span
                        className={cn("size-2 shrink-0 rounded-full", {
                          "bg-primary": item.enabled,
                          "bg-muted-foreground/40": !item.enabled,
                        })}
                      />
                    </button>
                  ))}
                  {!actionsQuery.isLoading && actions.length === 0 ? (
                    <p className="rounded-md border border-white/10 bg-white/3 p-3 text-sm text-muted-foreground">
                      No actions yet.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2 border-t border-white/10 pt-3">
                <FieldLabel>Nodes</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  {PALETTE.map((item) => (
                    <button
                      className="flex items-center gap-2 rounded-md border border-white/10 bg-white/4 p-2 text-left text-xs text-foreground transition-colors squircle hover:bg-white/8"
                      key={item.type}
                      onClick={() => addNode(item.type)}
                      type="button"
                    >
                      <HugeiconsIcon aria-hidden className="size-3.5 shrink-0" icon={item.icon} />
                      <span className="min-w-0 truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="relative min-h-0 bg-[#0b0b0b]">
            <ReactFlow
              colorMode="dark"
              deleteKeyCode={["Backspace", "Delete"]}
              edges={flowEdges}
              fitView
              maxZoom={1.4}
              minZoom={0.25}
              nodeTypes={nodeTypes}
              nodes={flowNodes}
              onConnect={connectNodes}
              onEdgesDelete={(deleted) =>
                setGraph((current) => ({
                  ...current,
                  edges: current.edges.filter(
                    (edge) => !deleted.some((deletedEdge) => deletedEdge.id === edge.id),
                  ),
                }))
              }
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onNodeDragStop={(_event, node) =>
                setGraph((current) => ({
                  ...current,
                  nodes: current.nodes.map((item) =>
                    item.id === node.id ? { ...item, position: node.position } : item,
                  ),
                }))
              }
              onNodesDelete={(deleted) =>
                setGraph((current) => ({
                  ...current,
                  edges: current.edges.filter(
                    (edge) =>
                      !deleted.some(
                        (deletedNode) =>
                          deletedNode.id === edge.source || deletedNode.id === edge.target,
                      ),
                  ),
                  nodes: current.nodes.filter(
                    (node) =>
                      node.type === "email_received" ||
                      !deleted.some((deletedNode) => deletedNode.id === node.id),
                  ),
                }))
              }
              proOptions={{ hideAttribution: true }}
            >
              <Background
                color="rgba(255,255,255,0.12)"
                gap={22}
                size={1}
                variant={BackgroundVariant.Dots}
              />
              <MiniMap
                className="border! border-white/10! bg-[#121212]!"
                maskColor="rgba(0,0,0,0.45)"
                nodeColor="#5e6ad2"
                pannable
                zoomable
              />
              <Controls className="border! border-white/10! bg-[#151515]! [&_button]:border-white/10! [&_button]:bg-[#151515]! [&_button]:text-foreground!" />
            </ReactFlow>
          </section>

          <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-black/20 p-4">
            {selectedNode ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {NODE_TITLES[selectedNode.type]}
                  </div>
                  <div className="text-xs text-muted-foreground">{selectedNode.id}</div>
                </div>

                {selectedNode.type === "ai_condition" ? (
                  <div className="space-y-2">
                    <FieldLabel>Criteria</FieldLabel>
                    <PanelTextarea
                      onChange={(event) =>
                        updateNode(selectedNode.id, (node) =>
                          node.type === "ai_condition"
                            ? { ...node, config: { criteria: event.target.value } }
                            : node,
                        )
                      }
                      value={selectedNode.config.criteria}
                    />
                  </div>
                ) : null}

                {selectedNode.type === "ai_router" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <FieldLabel>Instructions</FieldLabel>
                      <PanelTextarea
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) =>
                            node.type === "ai_router"
                              ? {
                                  ...node,
                                  config: { ...node.config, instructions: event.target.value },
                                }
                              : node,
                          )
                        }
                        value={selectedNode.config.instructions}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Ports</FieldLabel>
                      <Input
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) => {
                            if (node.type !== "ai_router") return node;
                            const ports = event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean);
                            return {
                              ...node,
                              config: {
                                ...node.config,
                                fallbackPort: ports.includes(node.config.fallbackPort)
                                  ? node.config.fallbackPort
                                  : (ports[0] ?? "other"),
                                ports: ports.length > 0 ? ports : ["other"],
                              },
                            };
                          })
                        }
                        value={selectedNode.config.ports.join(", ")}
                      />
                    </div>
                  </div>
                ) : null}

                {selectedNode.type === "set_variable" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <FieldLabel>Name</FieldLabel>
                      <Input
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) =>
                            node.type === "set_variable"
                              ? { ...node, config: { ...node.config, name: event.target.value } }
                              : node,
                          )
                        }
                        value={selectedNode.config.name}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Value</FieldLabel>
                      <Input
                        onChange={(event) =>
                          updateNode(selectedNode.id, (node) =>
                            node.type === "set_variable"
                              ? { ...node, config: { ...node.config, value: event.target.value } }
                              : node,
                          )
                        }
                        value={selectedNode.config.value}
                      />
                    </div>
                  </div>
                ) : null}

                {selectedNode.type === "merge" ? (
                  <div className="space-y-2">
                    <FieldLabel>Mode</FieldLabel>
                    <Select
                      items={[
                        { label: "Pass through", value: "pass_through" },
                        { label: "Wait for all", value: "wait_all" },
                      ]}
                      onValueChange={(value) =>
                        updateNode(selectedNode.id, (node) =>
                          node.type === "merge" &&
                          (value === "pass_through" || value === "wait_all")
                            ? { ...node, config: { mode: value } }
                            : node,
                        )
                      }
                      value={selectedNode.config.mode}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pass_through">Pass through</SelectItem>
                        <SelectItem value="wait_all">Wait for all</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedNode.type === "linear_agent_issue" ||
                selectedNode.type === "linear_create_issue" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel>Connector</FieldLabel>
                      <MentionChip />
                    </div>
                    {linearAccounts.length > 0 ? (
                      <Select
                        items={linearAccounts.map((account) => ({
                          label:
                            account.providerWorkspaceName ??
                            account.accountEmail ??
                            account.displayName ??
                            "Linear",
                          value: account.id,
                        }))}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateNode(selectedNode.id, (node) => {
                            if (node.type === "linear_agent_issue") {
                              return { ...node, config: { ...node.config, credentialId: value } };
                            }
                            if (node.type === "linear_create_issue") {
                              return { ...node, config: { ...node.config, credentialId: value } };
                            }
                            return node;
                          });
                        }}
                        value={selectedNode.config.credentialId ?? ""}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select Linear workspace" />
                        </SelectTrigger>
                        <SelectContent>
                          {linearAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.providerWorkspaceName ??
                                account.accountEmail ??
                                account.displayName ??
                                "Linear"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Button
                        disabled={startingLinear || linearConnector?.isConfigured === false}
                        onClick={() => void startLinearConnection()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {startingLinear ? (
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4 animate-spin"
                            icon={Loading03Icon}
                          />
                        ) : null}
                        Connect Linear
                      </Button>
                    )}

                    <div className="space-y-2">
                      <FieldLabel>Team</FieldLabel>
                      <Select
                        disabled={!selectedCredentialId || linearMetadataQuery.isLoading}
                        items={(linearMetadataQuery.data?.teams ?? []).map((team) => ({
                          label: `${team.name} (${team.key})`,
                          value: team.id,
                        }))}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateNode(selectedNode.id, (node) => {
                            if (node.type === "linear_agent_issue") {
                              return { ...node, config: { ...node.config, teamId: value } };
                            }
                            if (node.type === "linear_create_issue") {
                              return { ...node, config: { ...node.config, teamId: value } };
                            }
                            return node;
                          });
                        }}
                        value={selectedNode.config.teamId ?? ""}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select team" />
                        </SelectTrigger>
                        <SelectContent>
                          {(linearMetadataQuery.data?.teams ?? []).map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name} ({team.key})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedNode.type === "linear_agent_issue" ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <FieldLabel>Instructions</FieldLabel>
                          <MentionChip />
                        </div>
                        <PanelTextarea
                          className="min-h-36"
                          onChange={(event) =>
                            updateNode(selectedNode.id, (node) =>
                              node.type === "linear_agent_issue"
                                ? {
                                    ...node,
                                    config: { ...node.config, instructions: event.target.value },
                                  }
                                : node,
                            )
                          }
                          value={selectedNode.config.instructions}
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <FieldLabel>Title</FieldLabel>
                            <MentionChip />
                          </div>
                          <Input
                            onChange={(event) =>
                              updateNode(selectedNode.id, (node) =>
                                node.type === "linear_create_issue"
                                  ? {
                                      ...node,
                                      config: { ...node.config, title: event.target.value },
                                    }
                                  : node,
                              )
                            }
                            value={selectedNode.config.title ?? ""}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>Description</FieldLabel>
                          <PanelTextarea
                            className="min-h-36"
                            onChange={(event) =>
                              updateNode(selectedNode.id, (node) =>
                                node.type === "linear_create_issue"
                                  ? {
                                      ...node,
                                      config: { ...node.config, description: event.target.value },
                                    }
                                  : node,
                              )
                            }
                            value={selectedNode.config.description ?? ""}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {selectedNode.type === "email_received" ? (
                  <div className="rounded-md border border-white/10 bg-white/3 p-3 text-sm text-muted-foreground">
                    This trigger runs when Quieter persists a new inbound message for the selected
                    mailbox.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Select a node.</div>
            )}
          </aside>
        </div>

        <footer className="flex min-h-18 items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">Validation</div>
            {validationErrors.length > 0 ? (
              <div className="truncate text-sm text-destructive">{validationErrors[0]}</div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {draftRevision?.validationStatus === "valid"
                  ? "Draft is valid."
                  : "Save or publish to refresh validation."}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{graph.nodes.length} nodes</span>
            <span className="text-white/20">/</span>
            <span>{graph.edges.length} edges</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
