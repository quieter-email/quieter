// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";

import type { WorkspaceBridge } from "@quieter/app/features/chat/components/agent-workspace";
import { createForegroundControl } from "@quieter/app/features/chat/domain/foreground-control";
import type { ComposeHeldReceipt } from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import type { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { rpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import type { Button } from "@quieter/ui/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { ChatHeldSend } from "./chat-held-send";

type ComposeBridge = NonNullable<ReturnType<WorkspaceBridge["getCompose"]>>;
type HeldSend = NonNullable<RouterOutputs["mail"]["getHeldSend"]>;

const boundary = vi.hoisted(() => ({
  applyHeldReceipt: vi.fn<ComposeBridge["applyHeldReceipt"]>(),
  getHeldSend: vi.fn<typeof rpc.mail.getHeldSend>(),
  readCompose: vi.fn<ComposeBridge["read"]>(),
  toastError: vi.fn<typeof toastError>(),
  undoSend: vi.fn<typeof rpc.mail.undoSend>(),
}));
let currentWorkspace: WorkspaceBridge | null = null;

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const actual = await importOriginal();
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const rpc = {
    ...actual.rpc,
    mail: {
      ...actual.rpc.mail,
      getHeldSend: boundary.getHeldSend,
      undoSend: boundary.undoSend,
    },
  };
  return { ...actual, orpc: createTanstackQueryUtils(rpc), rpc };
});
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: boundary.toastError,
}));
vi.mock(import("../domain/workspace-context"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAgentWorkspace: () => currentWorkspace,
}));
// Shared UI keeps JSX for the app bundler; these tests exercise receipt state.
vi.mock(import("@quieter/ui/button"), () => ({
  Button: ({ children, onClick, pending }: ComponentProps<typeof Button>) => (
    <button disabled={pending} onClick={onClick} type="button">
      {children}
    </button>
  ),
}));
vi.mock(import("@quieter/ui/action-footer"), () => ({
  ActionFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));
vi.mock(import("@quieter/ui/text"), () => ({
  Text: ({ children }: ComponentProps<"p">) => <p>{children}</p>,
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const originalReceipt: ComposeHeldReceipt = {
  canUndo: true,
  draftId: "local-draft",
  draftRevision: 4,
  mailboxId: "mailbox",
  restoredDraftId: null,
  sendOperationId: "send-operation",
  status: "held",
  undoUntil: "2030-01-01T00:00:00.000Z",
};
const heldStatus = (overrides: Partial<HeldSend> = {}): HeldSend => ({
  canUndo: true,
  draftId: null,
  errorMessage: null,
  id: "held-record",
  mailboxId: originalReceipt.mailboxId,
  sendOperationId: originalReceipt.sendOperationId,
  status: "held",
  undoUntil: originalReceipt.undoUntil,
  ...overrides,
});
const flush = async (change: () => void) => {
  act(() => {
    change();
  });
  await act(async () => {
    await delay(20);
  });
};
const workspace = (compose: ComposeBridge | null): WorkspaceBridge => ({
  control: createForegroundControl(),
  getCalendar: () => null,
  getCompose: () => compose,
  mailboxId: "mailbox",
  navigate: vi.fn<WorkspaceBridge["navigate"]>().mockResolvedValue(),
  navigateCalendar: vi
    .fn<WorkspaceBridge["navigateCalendar"]>()
    .mockResolvedValue(),
  openCompose: vi.fn<WorkspaceBridge["openCompose"]>().mockResolvedValue({
    draftId: "another-local-draft",
    draftRevision: 1,
  }),
  openInlineCompose: vi
    .fn<WorkspaceBridge["openInlineCompose"]>()
    .mockResolvedValue({ draftId: "another-local-draft", draftRevision: 1 }),
  read: vi.fn<WorkspaceBridge["read"]>(() => ({
    generation: 1,
    mailboxId: "mailbox",
    query: "",
    view: "inbox",
    workspace: "mail",
  })),
  registerCalendar: () => () => {},
  registerCompose: () => () => {},
  registerInlineCompose: () => () => {},
  waitForCalendar: vi.fn<WorkspaceBridge["waitForCalendar"]>(),
  waitForCompose: vi.fn<WorkspaceBridge["waitForCompose"]>(),
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

const render = async () => {
  await flush(() => {
    root.render(
      <QueryClientProvider client={client}>
        <ChatHeldSend receipt={originalReceipt} />
      </QueryClientProvider>
    );
  });
};
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label
  );
  if (button === undefined) {
    throw new Error(`Missing ${label} control`);
  }
  await flush(() => {
    button.click();
  });
};
const readCanonicalStatus = () =>
  client.getQueryData(
    orpc.mail.getHeldSend.queryOptions({
      input: {
        mailboxId: originalReceipt.mailboxId,
        sendOperationId: originalReceipt.sendOperationId,
      },
    }).queryKey
  );

describe("assistant held-send recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    boundary.applyHeldReceipt.mockResolvedValue();
    boundary.getHeldSend.mockResolvedValue(heldStatus());
    boundary.undoSend.mockResolvedValue({
      draftId: "restored-provider-draft",
      status: "canceled",
    });
    boundary.readCompose.mockReturnValue({
      attachments: [],
      draftId: "different-current-draft",
      draftRevision: 99,
      inlineImages: [],
      providerDraftId: "different-provider-draft",
      values: {
        bcc: "",
        bodyHtml: "<p>Newer edits</p>",
        bodyText: "Newer edits",
        cc: "",
        senderName: "",
        subject: "Newer edits",
        to: "recipient@example.test",
      },
    });
    currentWorkspace = workspace({
      applyHeldReceipt: boundary.applyHeldReceipt,
      applyReceipt: vi.fn<ComposeBridge["applyReceipt"]>(),
      edit: vi.fn<ComposeBridge["edit"]>(),
      read: boundary.readCompose,
    });
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    client.clear();
    container.remove();
  });

  test("keeps the captured local identity through live status and human Undo", async () => {
    await render();
    boundary.getHeldSend.mockResolvedValue(
      heldStatus({
        canUndo: false,
        draftId: "restored-provider-draft",
        status: "canceled",
      })
    );
    await click("Undo send");

    expect(boundary.applyHeldReceipt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draftId: "local-draft",
        draftRevision: 4,
        mailboxId: "mailbox",
        restoredDraftId: "restored-provider-draft",
        sendOperationId: "send-operation",
        status: "canceled",
      })
    );
    expect(readCanonicalStatus()).toMatchObject({
      draftId: "restored-provider-draft",
      status: "canceled",
    });
  });

  test("retains committed cancellation when restoration fails during Undo", async () => {
    await render();
    const failure = new Error("The draft could not be restored");
    boundary.undoSend.mockRejectedValue(failure);
    boundary.getHeldSend.mockResolvedValue(
      heldStatus({ canUndo: false, status: "canceled" })
    );
    await click("Undo send");

    expect(boundary.toastError).toHaveBeenCalledWith(failure, {
      boundary: "assistant-undo-send",
    });
    expect(boundary.applyHeldReceipt).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoredDraftId: null, status: "canceled" })
    );
    expect(readCanonicalStatus()).toMatchObject({
      draftId: null,
      status: "canceled",
    });
    expect(container.textContent).toMatch(/sending canceled/iu);
  });

  test("catches local reopen failure and retries unchanged canonical status", async () => {
    const failure = new Error("Local storage is unavailable");
    boundary.applyHeldReceipt.mockRejectedValue(failure);
    boundary.getHeldSend.mockResolvedValue(
      heldStatus({
        canUndo: false,
        draftId: "restored-provider-draft",
        status: "canceled",
      })
    );
    await render();
    expect(boundary.toastError).toHaveBeenCalledWith(failure, {
      boundary: "assistant-held-receipt",
    });
    expect(container.textContent).toMatch(/sending canceled/iu);
    boundary.applyHeldReceipt.mockResolvedValue();
    boundary.applyHeldReceipt.mockClear();
    await click("Check delivery");

    expect(boundary.applyHeldReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "local-draft",
        restoredDraftId: "restored-provider-draft",
        status: "canceled",
      })
    );
    expect(readCanonicalStatus()).toMatchObject({
      draftId: "restored-provider-draft",
      status: "canceled",
    });
  });

  test.each([
    { mailboxId: "other-mailbox" },
    { sendOperationId: "other-operation" },
  ])(
    "does not forward status outside the captured operation: %j",
    async (mismatch) => {
      boundary.getHeldSend.mockResolvedValue(heldStatus(mismatch));
      await render();
      expect(boundary.applyHeldReceipt).not.toHaveBeenCalled();
    }
  );

  test("keeps chat status when the original composer is closed", async () => {
    currentWorkspace = workspace(null);
    boundary.getHeldSend.mockResolvedValue(
      heldStatus({ canUndo: false, status: "accepted" })
    );
    await render();

    expect(container.textContent).toMatch(/message sent/iu);
    expect(boundary.applyHeldReceipt).not.toHaveBeenCalled();
    expect(boundary.toastError).not.toHaveBeenCalled();
  });
});
