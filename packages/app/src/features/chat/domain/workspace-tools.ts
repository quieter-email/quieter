import {
  editComposeInputSchema,
  getWorkspaceInputSchema,
  navigateInputSchema,
  navigateCalendarInputSchema,
  openComposeInputSchema,
  openPanelInputSchema,
  openInlineComposeInputSchema,
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
      if (!workspace.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
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
    case "open_panel": {
      const command = openPanelInputSchema.parse(input);
      const { panel } = command;
      if (panel === "settings") {
        return { generation, status: "opening" };
      }
      if (
        panel === "new-calendar-event" &&
        workspace.read().workspace !== "calendar"
      ) {
        await workspace.navigateCalendar({}, generation);
      }
      if (panel === "snooze") {
        if (command.threadId === undefined) {
          throw new Error("Select a conversation to open Snooze.");
        }
        const selected = workspace.read();
        if (
          selected.workspace !== "mail" ||
          selected.selectedThreadId !== command.threadId
        ) {
          await workspace.navigate(
            { threadId: command.threadId, view: "inbox" },
            generation
          );
        }
        await workspace.openPanel(`snooze:${command.threadId}`, generation);
      }
      if (panel === "mail-search") {
        const current = workspace.read();
        if (
          current.workspace !== "mail" ||
          current.view === "labels" ||
          current.view === "rules" ||
          current.view === "snippets" ||
          current.view === "compose" ||
          current.selectedMessageId !== undefined ||
          current.selectedThreadId !== undefined
        ) {
          await workspace.navigate({ view: "inbox" }, generation);
        }
      }
      if (panel !== "snooze") {
        await workspace.openPanel(panel, generation);
      }
      if (!workspace.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      return { generation, status: "opened" };
    }
    case "open_inline_compose": {
      const draft = await workspace.openInlineCompose(
        openInlineComposeInputSchema.parse(input),
        generation
      );
      if (!workspace.control.isCurrent(generation)) {
        throw new Error("The request was stopped.");
      }
      return { ...draft, generation };
    }
    default: {
      throw new Error("This action is not available.");
    }
  }
};
