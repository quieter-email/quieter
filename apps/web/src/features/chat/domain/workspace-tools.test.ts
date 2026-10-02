import { describe, expect, test, vi } from "vite-plus/test";

import type { WorkspaceBridge } from "../components/agent-workspace";
import { createForegroundControl } from "./foreground-control";
import { executeWorkspaceTool } from "./workspace-tools";

type ComposeBridge = NonNullable<ReturnType<WorkspaceBridge["getCompose"]>>;

const createWorkspace = ({
  compose = null,
  mailboxId = "mailbox-a",
}: {
  compose?: ComposeBridge | null;
  mailboxId?: string;
} = {}) => {
  const control = createForegroundControl();
  const read = vi.fn<WorkspaceBridge["read"]>(() => ({
    generation: control.state.get().generation,
    mailboxId,
    query: "",
    view: "inbox",
  }));
  const navigate = vi.fn<WorkspaceBridge["navigate"]>().mockResolvedValue();
  const openCompose = vi
    .fn<WorkspaceBridge["openCompose"]>()
    .mockResolvedValue({ draftId: "draft-a", draftRevision: 1 });

  return {
    control,
    getCompose: () => compose,
    mailboxId,
    navigate,
    openCompose,
    read,
    registerCompose: () => () => {},
    waitForCompose: () => {
      throw new Error("The draft was not registered.");
    },
  } satisfies WorkspaceBridge;
};

const createCompose = () => {
  let revision = 4;
  const values = {
    bcc: "",
    bodyHtml: "<p>Initial</p>",
    bodyText: "Initial",
    cc: "",
    subject: "Initial subject",
    to: "person@example.test",
  };
  const edit = vi.fn<ComposeBridge["edit"]>((patch, expectedRevision) => {
    if (expectedRevision !== revision) {
      throw new Error("The draft changed.");
    }
    Object.assign(values, patch);
    revision += 1;
  });
  const compose: ComposeBridge = {
    applyReceipt: vi.fn<ComposeBridge["applyReceipt"]>(),
    edit,
    read: () => ({
      attachments: [],
      draftId: "draft-a",
      draftRevision: revision,
      inlineImages: [],
      values,
    }),
  };

  return { compose, edit, values };
};

describe("workspace tools", () => {
  test("reads from the bridge for the active mailbox only", async () => {
    const workspace = createWorkspace({ mailboxId: "mailbox-a" });
    const generation = workspace.control.begin();

    await expect(
      executeWorkspaceTool(workspace, "get_workspace", {}, generation)
    ).resolves.toMatchObject({ mailboxId: "mailbox-a", view: "inbox" });

    expect(workspace.read).toHaveBeenCalledOnce();
    expect(workspace.navigate).not.toHaveBeenCalled();
    expect(workspace.openCompose).not.toHaveBeenCalled();
  });

  test("does not dispatch commands for a stale generation", async () => {
    const workspace = createWorkspace();
    const staleGeneration = workspace.control.begin();
    workspace.control.cancel();

    await expect(
      executeWorkspaceTool(
        workspace,
        "navigate",
        { view: "sent" },
        staleGeneration
      )
    ).rejects.toThrow(/stopped/u);
    await expect(
      executeWorkspaceTool(workspace, "open_compose", {}, staleGeneration)
    ).rejects.toThrow(/stopped/u);

    expect(workspace.navigate).not.toHaveBeenCalled();
    expect(workspace.openCompose).not.toHaveBeenCalled();
    expect(workspace.read).not.toHaveBeenCalled();
  });

  test("does not return a workspace result after navigation is cancelled", async () => {
    const workspace = createWorkspace();
    const generation = workspace.control.begin();
    workspace.navigate.mockReturnValueOnce(
      Promise.resolve().then(() => {
        workspace.control.cancel();
      })
    );

    await expect(
      executeWorkspaceTool(
        workspace,
        "navigate",
        { query: "from:team@example.test" },
        generation
      )
    ).rejects.toThrow(/stopped/u);

    expect(workspace.navigate).toHaveBeenCalledWith(
      { query: "from:team@example.test" },
      generation
    );
    expect(workspace.read).not.toHaveBeenCalled();
  });

  test("rejects invalid inputs before they reach the workspace bridge", async () => {
    const workspace = createWorkspace();
    const generation = workspace.control.begin();

    await expect(
      executeWorkspaceTool(
        workspace,
        "navigate",
        { view: "compose" },
        generation
      )
    ).rejects.toThrow(/invalid|unrecognized/u);
    await expect(
      executeWorkspaceTool(
        workspace,
        "get_workspace",
        { unexpected: true },
        generation
      )
    ).rejects.toThrow(/invalid|unrecognized/u);

    expect(workspace.navigate).not.toHaveBeenCalled();
    expect(workspace.read).not.toHaveBeenCalled();
  });

  test("passes compose revisions to the bridge and leaves stale drafts unchanged", async () => {
    const { compose, edit, values } = createCompose();
    const workspace = createWorkspace({ compose });
    const generation = workspace.control.begin();

    await expect(
      executeWorkspaceTool(
        workspace,
        "edit_compose",
        {
          bodyText: "Stale edit",
          draftId: "draft-a",
          expectedDraftRevision: 3,
        },
        generation
      )
    ).rejects.toThrow(/draft changed/u);
    expect(values.bodyText).toBe("Initial");

    await expect(
      executeWorkspaceTool(
        workspace,
        "edit_compose",
        {
          bodyText: "Updated draft",
          draftId: "draft-a",
          expectedDraftRevision: 4,
        },
        generation
      )
    ).resolves.toStrictEqual({
      draftId: "draft-a",
      draftRevision: 5,
      generation,
    });
    expect(edit).toHaveBeenLastCalledWith({ bodyText: "Updated draft" }, 4);
  });
});
