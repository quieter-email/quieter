import type { WorkspaceBridge } from "@quieter/app/features/chat/components/agent-workspace";
import { createContext, useContext } from "react";

export const AgentWorkspaceContext = createContext<WorkspaceBridge | null>(
  null
);

export const useAgentWorkspace = () => useContext(AgentWorkspaceContext);
