import { ORPCError } from "@orpc/server";

import { CLICKUP_TOOLS, callClickUpTool } from "./clickup";
import type { ConnectorProvider } from "./contracts";
import { ONEDRIVE_TOOLS, callOneDriveTool } from "./microsoft-onedrive";
import { NOTION_TOOLS, callNotionTool } from "./notion";
import { TODOIST_TOOLS, callTodoistTool } from "./todoist";

type ConnectorToolCall = {
  arguments: Record<string, unknown>;
  connectionId: string;
  signal?: AbortSignal;
  toolName: string;
  userId: string;
};

type ConnectorToolRegistryEntry = {
  call: (input: ConnectorToolCall) => Promise<unknown>;
  tools: readonly {
    name: string;
    description: string;
    effect: "read" | "write";
    inputSchema: unknown;
  }[];
};

export const connectorToolRegistry: Partial<
  Record<ConnectorProvider, ConnectorToolRegistryEntry>
> = {
  clickup: { call: callClickUpTool, tools: CLICKUP_TOOLS },
  microsoft_onedrive: { call: callOneDriveTool, tools: ONEDRIVE_TOOLS },
  notion: { call: callNotionTool, tools: NOTION_TOOLS },
  todoist: { call: callTodoistTool, tools: TODOIST_TOOLS },
};

export const callRegisteredConnectorTool = async (
  input: ConnectorToolCall & {
    effect: "read" | "write";
    provider: ConnectorProvider;
  }
) => {
  const registry = connectorToolRegistry[input.provider];
  const descriptor = registry?.tools.find(
    (tool) => tool.name === input.toolName
  );
  if (!registry || descriptor?.effect !== input.effect) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This connected account does not support that action.",
    });
  }
  return await registry.call(input);
};
