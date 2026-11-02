import {
  editComposeInputSchema,
  getWorkspaceInputSchema,
  navigateInputSchema,
  navigateCalendarInputSchema,
  openComposeInputSchema,
} from "@quieter/ai/chat-tools";
import type { WorkspaceBridge } from "@quieter/app/features/chat/components/agent-workspace";

export const executeWorkspaceTool = async (
  workspace: WorkspaceBridge,
  name: string,
  input: unknown,
  generation: number
) => {
  if (!workspace.control.isCurrent(generation)) {
    throw new Error("The request was stopped.");
  }
  switch (name) {
    case "get_workspace": {
      getWorkspaceInputSchema.parse(input);
      return workspace.read();
    }
    case "navigate": {
      await workspace.navigate(navigateInputSchema.parse(input), generation);
      if (!workspace.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      return workspace.read();
    }
    case "navigate_calendar": {
      await workspace.navigateCalendar(
        navigateCalendarInputSchema.parse(input),
        generation
      );
      if (!workspace.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      return workspace.read();
    }
    case "open_compose": {
      const draft = await workspace.openCompose(
        openComposeInputSchema.parse(input),
        generation
      );
      return { ...draft, generation };
    }
    case "edit_compose": {
      if (workspace.read().workspace === "calendar") {
        throw new Error("Open Mail before editing an email draft.");
      }
      const { draftId, expectedDraftRevision, ...values } =
        editComposeInputSchema.parse(input);
      const compose = workspace.getCompose();
      if (!compose || compose.read().draftId !== draftId) {
        throw new Error("This draft is no longer open.");
      }
      compose.edit(values, expectedDraftRevision);
      return {
        draftId,
        draftRevision: compose.read().draftRevision,
        generation,
      };
    }
    default: {
      throw new Error("This action is not available.");
    }
  }
};
