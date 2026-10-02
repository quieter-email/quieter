import { createContext, useContext } from "react";

import type { WorkspaceBridge } from "../components/agent-workspace";

export const AgentWorkspaceContext = createContext<WorkspaceBridge | null>(
  null
);

export const useAgentWorkspace = () => useContext(AgentWorkspaceContext);
