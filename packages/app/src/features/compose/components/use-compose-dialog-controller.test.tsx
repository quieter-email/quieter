// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { createEmptyComposeDraft } from "@quieter/app/features/compose/domain/draft";
import { restoreComposeDraft } from "@quieter/app/features/compose/domain/draft-recovery";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import type { toastError } from "@quieter/app/lib/error-toast";
import type {
  refreshCachedMailboxQueries,
  removeDraftMessageFromCaches,
} from "@quieter/app/lib/mail/inbox-query/index";
import type { rpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseBlockerOpts } from "@tanstack/react-router";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { useComposeDialogController } from "./use-compose-dialog-controller";
import type {
  ComposeDialogController,
  ComposeHeldReceipt,
} from "./use-compose-dialog-controller";

type RegisteredCompose = NonNullable<
  ReturnType<NonNullable<ReturnType<typeof useAgentWorkspace>>["getCompose"]>
> & {
  applyHeldReceipt: (receipt: ComposeHeldReceipt) => Promise<void>;
};

type FixtureLocation = Pick<
  Parameters<UseBlockerOpts["shouldBlockFn"]>[0]["current"],
  "pathname"
> & { search: object };

const boundary = vi.hoisted(
  (): {
    compose: RegisteredCompose | null;
    autosave: (() => Promise<boolean>) | null;
    navigate: (() => Promise<boolean>) | null;
    mailboxId: string;
    sessionId: string;
    getDraft: ReturnType<typeof vi.fn<typeof rpc.mail.getDraft>>;
    getAttachment: ReturnType<typeof vi.fn<typeof rpc.mail.getAttachment>>;
    getHeldSend: ReturnType<typeof vi.fn<typeof rpc.mail.getHeldSend>>;
    undoSend: ReturnType<typeof vi.fn<typeof rpc.mail.undoSend>>;
    saveDraft: ReturnType<typeof vi.fn<typeof rpc.mail.saveDraft>>;
    sendMessage: ReturnType<typeof vi.fn<typeof rpc.mail.sendMessage>>;
    deleteDraft: ReturnType<typeof vi.fn<typeof rpc.mail.deleteDraft>>;
    toastError: ReturnType<typeof vi.fn<typeof toastError>>;
  } => ({
    autosave: null,
    compose: null,
    deleteDraft: vi.fn<typeof rpc.mail.deleteDraft>(),
    getAttachment: vi.fn<typeof rpc.mail.getAttachment>(),
    getDraft: vi.fn<typeof rpc.mail.getDraft>(),
    getHeldSend: vi.fn<typeof rpc.mail.getHeldSend>(),
    mailboxId: "mailbox",
    navigate: null,
    saveDraft: vi.fn<typeof rpc.mail.saveDraft>(),
    sendMessage: vi.fn<typeof rpc.mail.sendMessage>(),
    sessionId: "session",
    toastError: vi.fn<typeof toastError>(),
    undoSend: vi.fn<typeof rpc.mail.undoSend>(),
  })
);

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const actual = await importOriginal();
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const rpc = {
    ...actual.rpc,
    mail: {
      ...actual.rpc.mail,
      deleteDraft: boundary.deleteDraft,
      getAttachment: boundary.getAttachment,
      getDraft: boundary.getDraft,
      getHeldSend: boundary.getHeldSend,
      saveDraft: boundary.saveDraft,
      sendMessage: boundary.sendMessage,
      undoSend: boundary.undoSend,
    },
  };
  return { ...actual, orpc: createTanstackQueryUtils(rpc), rpc };
});
vi.mock(import("@quieter/app/lib/auth"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    authClient: {
      ...actual.authClient,
      useSession: () => ({
        data: {
          session: {
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            id: boundary.sessionId,
            token: "fixture-token",
            updatedAt: new Date(),
            userId: "user",
          },
          user: {
            createdAt: new Date(),
            email: "writer@example.com",
            emailVerified: true,
            id: "user",
            name: "Writer",
            updatedAt: new Date(),
          },
        },
        error: null,
        isPending: false,
        isRefetching: false,
        refetch:
          vi.fn<ReturnType<typeof actual.authClient.useSession>["refetch"]>(),
      }),
    },
  } satisfies typeof actual;
});
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: boundary.toastError,
}));
vi.mock(import("@quieter/ui/toast"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toast: Object.assign(
      vi.fn<typeof actual.toast>().mockReturnValue("toast"),
      actual.toast,
      {
        success: vi.fn<typeof actual.toast.success>().mockReturnValue("toast"),
      }
    ),
  } satisfies typeof actual;
});
vi.mock(import("@quieter/app/lib/mail/inbox-query/index"), () => ({
  refreshCachedMailboxQueries: vi
    .fn<typeof refreshCachedMailboxQueries>()
    .mockResolvedValue(),
  removeDraftMessageFromCaches: vi
    .fn<typeof removeDraftMessageFromCaches>()
    .mockResolvedValue(),
}));
vi.mock(import("./use-draft-autosave"), () => ({
  useDraftAutosave: ({ save }: { save: () => Promise<boolean> }) => {
    boundary.autosave = save;
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- This callback fixture omits the router's generic resolver and legacy overloads.
vi.mock("@tanstack/react-router", () => ({
  useBlocker: (options: {
    shouldBlockFn: (locations: {
      current: FixtureLocation;
      next: FixtureLocation;
    }) => ReturnType<UseBlockerOpts["shouldBlockFn"]>;
  }) => {
    boundary.navigate = async () =>
      await options.shouldBlockFn({
        current: {
          pathname: "/mail",
          search: {},
        },
        next: {
          pathname: "/settings",
          search: {},
        },
      });
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- This compose fixture omits unrelated calendar and workspace navigation contracts.
vi.mock("@quieter/app/features/chat/domain/workspace-context", () => {
  const workspace = {
    get mailboxId() {
      return boundary.mailboxId;
    },
    registerCompose: (compose: RegisteredCompose) => {
      boundary.compose = compose;
      return () => {
        if (boundary.compose === compose) {
          boundary.compose = null;
        }
      };
    },
  };
  return { useAgentWorkspace: () => workspace };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal(
  "URL",
  class FixtureURL extends URL {
    static createObjectURL() {
      return `blob:${crypto.randomUUID()}`;
    }
    static revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>();
  }
);

const readCompose = () => {
  if (!boundary.compose) {
    throw new Error("The composer did not register.");
  }
  return boundary.compose;
};

const receiptFor = (
  overrides: Partial<ComposeHeldReceipt> = {}
): ComposeHeldReceipt => {
  const draft = readCompose().read();
  if (!draft.sendOperationId) {
    throw new Error("Missing send operation.");
  }
  return {
    canUndo: true,
    draftId: draft.draftId,
    draftRevision: draft.draftRevision,
    mailboxId: "mailbox",
    restoredDraftId: null,
    sendOperationId: draft.sendOperationId,
    status: "held",
    undoUntil: new Date(Date.now() + 10_000).toISOString(),
    ...overrides,
  };
};

const flush = async (change: () => void) => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

let controller: ComposeDialogController;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let container: HTMLDivElement;
const initial = (): ComposeDraftState => ({
  ...createEmptyComposeDraft(),
  bodyHtml: "<p>Proposal body</p>",
  bodyText: "Proposal body",
  recipients: { bcc: "", cc: "", to: "reader@example.com" },
  subject: "Proposal",
});

const canonicalDraft = (): RouterOutputs["mail"]["getDraft"] => ({
  attachments: [],
  baseRevision: "canonical-revision",
  bodyHtml: "<p>Canonical body</p>",
  bodyText: "Canonical body",
  draftAnchor: null,
  draftId: "restored",
  inlineImages: [],
  lastSavedAt: Date.now(),
  messageId: "restored-message",
  recipients: { bcc: "", cc: "", to: "reader@example.com" },
  replyContext: null,
  senderName: "Sender",
  subject: "Canonical",
});

const mount = async (draft = initial(), initialDraftNeedsSave = false) => {
  const Fixture = ({ mailboxId }: { mailboxId: string }) => {
    const value = useComposeDialogController({
      editorReady: true,
      getTextFromHtml: (html) =>
        new DOMParser().parseFromString(html, "text/html").body.textContent ??
        "",
      initialDraft: draft,
      initialDraftNeedsSave,
      mailboxId,
      normalizeHtml: (html) => html,
    });
    useLayoutEffect(() => {
      controller = value;
    });
    return null;
  };
  const render = async (mailboxId = "mailbox") => {
    boundary.mailboxId = mailboxId;
    const DraftFixture = Fixture;
    await flush(() => {
      root.render(
        <QueryClientProvider client={client}>
          <DraftFixture mailboxId={mailboxId} />
        </QueryClientProvider>
      );
    });
  };
  await render();
  return render;
};

describe("compose controller", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    boundary.compose = null;
    boundary.mailboxId = "mailbox";
    await draftRecoveryJournal.captureCleanup()?.();
    boundary.sessionId = crypto.randomUUID();
    await draftRecoveryJournal.setUser("user", boundary.sessionId);
    boundary.getHeldSend.mockImplementation(
      async (input) =>
        await Promise.resolve({
          canUndo: true,
          draftId: null,
          errorMessage: null,
          id: "held",
          mailboxId: input.mailboxId,
          sendOperationId: input.sendOperationId,
          status: "held",
          undoUntil: new Date(Date.now() + 10_000).toISOString(),
        })
    );
    boundary.getDraft.mockResolvedValue(canonicalDraft());
    boundary.getAttachment.mockResolvedValue({
      attachmentId: "provider-attachment",
      file: new File(["notes"], "notes.txt", { type: "text/plain" }),
      size: 5,
    });
    boundary.undoSend.mockResolvedValue({
      draftId: "restored",
      status: "canceled",
    });
    boundary.saveDraft.mockImplementation(
      async ({ draft }) =>
        await Promise.resolve({
          attachments: [],
          baseRevision: "saved",
          bodyHtml: draft.bodyHtml,
          bodyText: draft.bodyText,
          draftAnchor: draft.draftAnchor ?? null,
          draftId: "saved",
          inlineImages: [],
          messageId: "saved-message",
          recipients: draft.recipients,
          replyContext: draft.replyContext
            ? {
                ...draft.replyContext,
                references: draft.replyContext.references ?? [],
              }
            : null,
          subject: draft.subject,
        } satisfies RouterOutputs["mail"]["saveDraft"])
    );
    boundary.sendMessage.mockImplementation(
      async (input) =>
        await Promise.resolve({
          canUndo: true,
          draftId: null,
          errorMessage: null,
          id: "held",
          mailboxId: input.mailboxId,
          sendOperationId: input.message.sendOperationId ?? crypto.randomUUID(),
          status: "held",
          undoUntil: new Date().toISOString(),
        })
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await flush(() => {
      root.unmount();
    });
    client.clear();
    container.remove();
    vi.restoreAllMocks();
    await draftRecoveryJournal.captureCleanup()?.();
  });

  describe("held composer receipts", () => {
    it("keeps recovery active when an accepted completion becomes stale during journal cleanup", async () => {
      const session = draftRecoveryJournal.session("user", boundary.sessionId);
      const cleanup = Promise.withResolvers<null>();
      vi.spyOn(draftRecoveryJournal, "session").mockReturnValue({
        ...session,
        list: async (scope) => {
          if (scope.mailboxId === "mailbox") {
            await cleanup.promise;
          }
          return await session.list(scope);
        },
      });
      const rerender = await mount();
      const receipt = receiptFor();
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      let acceptance: Promise<void> | undefined;
      await flush(() => {
        acceptance = readCompose().applyHeldReceipt({
          ...receipt,
          status: "accepted",
        });
      });
      await rerender("other");
      await act(async () => {
        cleanup.resolve(null);
        await acceptance;
      });
      expect(controller.state.open).toBeTruthy();
      await flush(() => {
        controller.form.setFieldValue("subject", "Current mailbox work");
        window.dispatchEvent(new Event("pagehide"));
      });
      await vi.waitFor(async () => {
        const records = await session.list({
          mailboxId: "other",
          userId: "user",
        });
        expect(
          records.some(
            (record) =>
              restoreComposeDraft(record.payload, record.editorId).subject ===
              "Current mailbox work"
          )
        ).toBeTruthy();
      });
    });

    it("keeps the newer-edits fence after reload and preserves a recovery copy already edited by its owner", async () => {
      const sendOperationId = crypto.randomUUID();
      const frozen = restoreComposeDraft(
        JSON.stringify({
          ...initial(),
          heldDraftHasNewerEdits: true,
          holdAttempt: true,
          sendOperationId,
          sendUncertain: true,
        }),
        "earlier-editor"
      );
      await mount(frozen);
      const localId = `held-edits-${sendOperationId}`;
      const recovery = draftRecoveryJournal.session("user", boundary.sessionId);
      await recovery.save({
        editorId: localId,
        localId,
        mailboxId: "mailbox",
        payload: JSON.stringify({
          ...initial(),
          assistantUnsaved: true,
          localId,
          subject: "Resumed recovery work",
        }),
        updatedAt: Date.now(),
        userId: "user",
      });
      await act(async () => {
        await readCompose().applyHeldReceipt(
          receiptFor({ status: "accepted" })
        );
      });
      const records = await recovery.list({
        mailboxId: "mailbox",
        userId: "user",
      });
      const preserved = records.find((record) => record.localId === localId);
      expect(preserved).toBeDefined();
      if (!preserved) {
        throw new Error("Missing preserved edits.");
      }
      expect(
        restoreComposeDraft(preserved.payload, preserved.editorId).subject
      ).toBe("Resumed recovery work");
      expect(controller.state.open).toBeFalsy();
    });

    it("verifies a recovery write that silently does nothing and retries through Check delivery", async () => {
      const session = draftRecoveryJournal.session("user", boundary.sessionId);
      let omitCopyWrite = true;
      vi.spyOn(draftRecoveryJournal, "session").mockReturnValue({
        ...session,
        save: async (record) => {
          if (!omitCopyWrite || !record.editorId.startsWith("held-edits-")) {
            await session.save(record);
          }
        },
      });
      await mount();
      const receipt = receiptFor({ draftRevision: -1 });
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      await act(async () => {
        await expect(
          readCompose().applyHeldReceipt({ ...receipt, status: "accepted" })
        ).rejects.toThrow(/newer draft edits/iu);
      });
      expect(controller.state).toMatchObject({
        draft: { heldDraftHasNewerEdits: true, sendUncertain: true },
        open: true,
      });
      omitCopyWrite = false;
      boundary.getHeldSend.mockResolvedValue({
        canUndo: false,
        draftId: null,
        errorMessage: null,
        id: "held",
        mailboxId: "mailbox",
        sendOperationId: receipt.sendOperationId,
        status: "accepted",
        undoUntil: null,
      });
      await act(async () => {
        await controller.checkSendDelivery();
      });
      expect(controller.state.open).toBeFalsy();
      const persisted = await session.list({
        mailboxId: "mailbox",
        userId: "user",
      });
      expect(
        persisted.some((record) => record.localId !== receipt.draftId)
      ).toBeTruthy();
    });

    it("ignores other identities and preserves newer edits through a same-operation terminal receipt", async () => {
      await mount();
      const admitted = receiptFor();
      await act(async () => {
        for (const mismatch of [
          { mailboxId: "other" },
          { draftId: "other" },
          { sendOperationId: crypto.randomUUID() },
        ]) {
          await readCompose().applyHeldReceipt({ ...admitted, ...mismatch });
        }
      });
      expect(controller.state.draft.sendUncertain).not.toBeTruthy();
      await flush(() => {
        controller.form.setFieldValue("subject", "Later human edits");
      });
      await act(async () => {
        await readCompose().applyHeldReceipt(admitted);
      });
      expect(controller.state.draft).toMatchObject({
        heldDraftHasNewerEdits: true,
        sendUncertain: true,
      });
      expect(controller.form.state.values.subject).toBe("Later human edits");
      await act(async () => {
        await readCompose().applyHeldReceipt({
          ...admitted,
          draftRevision: readCompose().read().draftRevision,
          status: "accepted",
        });
      });
      expect(controller.state.open).toBeFalsy();
      const records = await draftRecoveryJournal
        .session("user", boundary.sessionId)
        .list({ mailboxId: "mailbox", userId: "user" });
      const copy = records.find(
        (record) => record.localId !== admitted.draftId
      );
      expect(copy).toBeDefined();
      if (!copy) {
        throw new Error("Missing recovery copy.");
      }
      expect(restoreComposeDraft(copy.payload, copy.editorId)).toMatchObject({
        assistantUnsaved: true,
        sendUncertain: false,
        subject: "Later human edits",
      });
      expect(boundary.saveDraft).not.toHaveBeenCalled();
    });

    it("coalesces cancellation and uses the complete canonical draft while rejecting late old receipts", async () => {
      await mount();
      const receipt = receiptFor();
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      const restored = canonicalDraft();
      const completeRestore =
        Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.getDraft>>>();
      boundary.getDraft.mockReturnValue(completeRestore.promise);
      let first: Promise<void> | undefined;
      let second: Promise<void> | undefined;
      await flush(() => {
        first = controller.restoreHeldMessage();
        second = readCompose().applyHeldReceipt({
          ...receipt,
          restoredDraftId: "restored",
          status: "canceled",
        });
      });
      expect(controller.state.isFinishing).toBeTruthy();
      await act(async () => {
        const canonical = {
          ...restored,
          draftId: "restored",
          followUpReminder: {
            condition: "No reply",
            dueAt: "2027-02-01T10:00:00Z",
            requestId: crypto.randomUUID(),
            timeZone: "UTC",
            title: "Follow up",
          } satisfies NonNullable<ComposeDraftState["followUpReminder"]>,
          senderName: "Restored sender",
          subject: "Canonical subject",
        };
        completeRestore.resolve(canonical);
        await Promise.all([first, second]);
      });
      expect(controller.form.state.values).toMatchObject({
        senderName: "Restored sender",
        subject: "Canonical subject",
      });
      expect(controller.state.draft.followUpReminder).toBeDefined();
      expect(boundary.getDraft).toHaveBeenCalledOnce();
      expect(boundary.undoSend).toHaveBeenCalledOnce();
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      expect(controller.state.draft.sendUncertain).toBeFalsy();
      expect(readCompose().read().sendOperationId).not.toBe(
        receipt.sendOperationId
      );
    });

    it.each(["mailbox", "unmount"])(
      "does not apply an asynchronous restore after %s changes",
      async (change) => {
        const rerender = await mount();
        await act(async () => {
          await readCompose().applyHeldReceipt(receiptFor());
        });
        const completeRestore =
          Promise.withResolvers<
            Awaited<ReturnType<typeof rpc.mail.getDraft>>
          >();
        boundary.getDraft.mockReturnValue(completeRestore.promise);
        let restoration: Promise<void> | undefined;
        await flush(() => {
          restoration = controller.restoreHeldMessage();
        });
        if (change === "mailbox") {
          await rerender("other");
        } else {
          await flush(() => {
            root.render(null);
          });
        }
        await act(async () => {
          completeRestore.resolve({
            ...canonicalDraft(),
            subject: "Stale canonical",
          });
          await restoration;
        });
        expect(controller.form.state.values.subject).toBe("Proposal");
      }
    );

    it("keeps the original frozen if recovery persistence is revoked", async () => {
      await mount();
      const receipt = receiptFor({ draftRevision: -1 });
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      await draftRecoveryJournal.captureCleanup()?.();
      await act(async () => {
        await expect(
          readCompose().applyHeldReceipt({ ...receipt, status: "accepted" })
        ).rejects.toThrow(/recovery|newer draft edits/iu);
      });
      expect(controller.state).toMatchObject({
        draft: { heldDraftHasNewerEdits: true, sendUncertain: true },
        open: true,
      });
      expect(boundary.toastError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ boundary: "compose-held-send" })
      );
    });

    it("distinguishes an abandoned admission from a canceled send missing its restored draft", async () => {
      await mount();
      const receipt = receiptFor();
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      boundary.undoSend.mockResolvedValueOnce({
        draftId: null,
        status: "canceled",
      });
      await act(async () => {
        await controller.restoreHeldMessage();
      });
      expect(controller.state.draft.sendUncertain).toBeTruthy();
      expect(boundary.getDraft).not.toHaveBeenCalled();
      boundary.undoSend.mockResolvedValueOnce({
        draftId: null,
        status: "abandoned",
      });
      await act(async () => {
        await controller.restoreHeldMessage();
      });
      expect(controller.state.draft.sendUncertain).toBeFalsy();
      expect(controller.form.state.values.subject).toBe("Proposal");
    });

    it.each(["initial", "recovered"])(
      "saves %s unsaved provider draft edits before closing an abandoned send",
      async (source) => {
        const subject = `Latest ${source} work`;
        await mount(
          {
            ...initial(),
            draftId: "existing",
            saveStatus: source === "initial" ? "saved" : "idle",
            subject,
          },
          source === "initial"
        );
        await act(async () => {
          await readCompose().applyHeldReceipt(receiptFor());
        });
        boundary.undoSend.mockResolvedValueOnce({
          draftId: null,
          status: "abandoned",
        });
        await act(async () => {
          await controller.restoreHeldMessage();
          await controller.closeComposeDialog();
        });
        expect(boundary.saveDraft.mock.calls[0]?.[0].draft).toMatchObject({
          draftId: "existing",
          subject,
        });
        expect(controller.state.open).toBeFalsy();
      }
    );

    it.each(["saved", "failed"])(
      "ignores an old pending save that %s after canonical Undo",
      async (outcome) => {
        await mount({ ...initial(), draftId: "existing" }, true);
        const pendingSave =
          Promise.withResolvers<
            Awaited<ReturnType<typeof rpc.mail.saveDraft>>
          >();
        boundary.saveDraft.mockReturnValueOnce(pendingSave.promise);
        let saving: Promise<void> | undefined;
        await flush(() => {
          saving = controller.saveDraft();
        });
        await act(async () => {
          await readCompose().applyHeldReceipt(receiptFor());
          await controller.restoreHeldMessage();
        });
        const restored = canonicalDraft();
        await act(async () => {
          if (outcome === "saved") {
            pendingSave.resolve({
              ...restored,
              baseRevision: "obsolete-revision",
              draftId: "obsolete-draft",
              messageId: "obsolete-message",
            });
          } else {
            pendingSave.reject(new Error("Obsolete save failed"));
          }
          await saving;
        });
        expect(controller.state.draft).toMatchObject({
          baseRevision: restored.baseRevision,
          draftId: restored.draftId,
          messageId: restored.messageId,
          saveStatus: "saved",
        });
        expect(controller.form.state.values.subject).toBe(restored.subject);
        expect(boundary.toastError).not.toHaveBeenCalled();
      }
    );

    it("does not resume a waiting human Send after canonical Undo", async () => {
      await mount({ ...initial(), draftId: "existing" }, true);
      const pendingSave =
        Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.saveDraft>>>();
      boundary.saveDraft.mockReturnValueOnce(pendingSave.promise);
      let saving: Promise<void> | undefined;
      let sending: Promise<void> | undefined;
      await flush(() => {
        saving = controller.saveDraft();
      });
      await flush(() => {
        sending = controller.form.handleSubmit();
      });
      expect(controller.state.draft.saveStatus).toBe("sending");
      const receipt = receiptFor();
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
        await readCompose().applyHeldReceipt({
          ...receipt,
          restoredDraftId: "restored",
          status: "canceled",
        });
      });
      await act(async () => {
        pendingSave.resolve({
          ...canonicalDraft(),
          baseRevision: "old-revision",
          draftId: "existing",
          messageId: "old-message",
        });
        await Promise.all([saving, sending]);
      });
      expect(boundary.sendMessage).not.toHaveBeenCalled();
      expect(controller.state).toMatchObject({
        draft: { draftId: "restored", sendUncertain: false },
        open: true,
      });
      expect(controller.form.state.values.subject).toBe("Canonical");
      expect(readCompose().read().sendOperationId).not.toBe(
        receipt.sendOperationId
      );
    });

    it("leaves an edited waiting Send editable for a fresh submission", async () => {
      await mount({ ...initial(), draftId: "existing" }, true);
      const pendingSave =
        Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.saveDraft>>>();
      boundary.saveDraft.mockReturnValueOnce(pendingSave.promise);
      let saving: Promise<void> | undefined;
      let sending: Promise<void> | undefined;
      await flush(() => {
        saving = controller.saveDraft();
      });
      await flush(() => {
        sending = controller.form.handleSubmit();
      });
      await flush(() => {
        controller.form.setFieldValue("subject", "Revised before sending");
      });
      await act(async () => {
        pendingSave.resolve({
          ...canonicalDraft(),
          baseRevision: "old-revision",
          draftId: "existing",
          messageId: "old-message",
        });
        await Promise.all([saving, sending]);
      });
      expect(boundary.sendMessage).not.toHaveBeenCalled();
      expect(controller.state.draft.saveStatus).toBe("idle");
      expect(controller.state.draft.sendUncertain).not.toBeTruthy();
      await act(async () => {
        await controller.form.handleSubmit();
      });
      expect(boundary.sendMessage.mock.calls[0]?.[0]).toMatchObject({
        message: { subject: "Revised before sending" },
      });
    });

    it("retains newly held recovery when a waiting Close resumes", async () => {
      await mount({ ...initial(), draftId: "existing" }, true);
      const pendingSave =
        Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.saveDraft>>>();
      boundary.saveDraft.mockReturnValueOnce(pendingSave.promise);
      let saving: Promise<void> | undefined;
      let closing: Promise<void> | undefined;
      await flush(() => {
        saving = controller.saveDraft();
      });
      await flush(() => {
        closing = controller.closeComposeDialog();
      });
      const receipt = receiptFor();
      await act(async () => {
        await readCompose().applyHeldReceipt(receipt);
      });
      await act(async () => {
        pendingSave.resolve({
          ...canonicalDraft(),
          baseRevision: "old-revision",
          draftId: "existing",
          messageId: "old-message",
        });
        await Promise.all([saving, closing]);
      });
      expect(controller.state.open).toBeTruthy();
      await vi.waitFor(async () => {
        const records = await draftRecoveryJournal
          .session("user", boundary.sessionId)
          .list({ mailboxId: "mailbox", userId: "user" });
        expect(
          records.some((record) => {
            const draft = restoreComposeDraft(record.payload, record.editorId);
            return (
              draft.sendOperationId === receipt.sendOperationId &&
              draft.sendUncertain === true
            );
          })
        ).toBeTruthy();
      });
    });

    it("does not release a restoring held task when the old Close finishes", async () => {
      await mount({ ...initial(), draftId: "existing" }, true);
      const pendingSave =
        Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.saveDraft>>>();
      const pendingRestore =
        Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.getDraft>>>();
      boundary.saveDraft.mockReturnValueOnce(pendingSave.promise);
      boundary.getDraft.mockReturnValueOnce(pendingRestore.promise);
      let saving: Promise<void> | undefined;
      let closing: Promise<void> | undefined;
      let restoring: Promise<void> | undefined;
      await flush(() => {
        saving = controller.saveDraft();
      });
      await flush(() => {
        closing = controller.closeComposeDialog();
      });
      const receipt = receiptFor();
      await flush(() => {
        restoring = readCompose().applyHeldReceipt({
          ...receipt,
          restoredDraftId: "restored",
          status: "canceled",
        });
      });
      await act(async () => {
        pendingSave.resolve({
          ...canonicalDraft(),
          baseRevision: "old-revision",
          draftId: "existing",
          messageId: "old-message",
        });
        await Promise.all([saving, closing]);
      });
      expect(controller.state).toMatchObject({
        draft: { sendUncertain: true },
        isFinishing: true,
        open: true,
      });
      await act(async () => {
        pendingRestore.resolve(canonicalDraft());
        await restoring;
      });
      expect(controller.state).toMatchObject({
        draft: { draftId: "restored", sendUncertain: false },
        isFinishing: false,
        open: true,
      });
    });

    it.each(["close", "navigate"])(
      "does not let a waiting %s discard canonical edits after Undo",
      async (action) => {
        await mount({ ...initial(), draftId: "existing" }, true);
        const pendingSave =
          Promise.withResolvers<
            Awaited<ReturnType<typeof rpc.mail.saveDraft>>
          >();
        boundary.saveDraft.mockReturnValueOnce(pendingSave.promise);
        let saving: Promise<void> | undefined;
        let finishing: Promise<unknown> | undefined;
        await flush(() => {
          saving = controller.saveDraft();
        });
        await flush(() => {
          finishing =
            action === "close"
              ? controller.closeComposeDialog()
              : boundary.navigate?.();
        });
        const receipt = receiptFor();
        await act(async () => {
          await readCompose().applyHeldReceipt(receipt);
          await controller.restoreHeldMessage();
        });
        await flush(() => {
          controller.form.setFieldValue("subject", "New canonical edits");
          window.dispatchEvent(new Event("pagehide"));
        });
        let blocked: unknown;
        await act(async () => {
          pendingSave.resolve({
            ...canonicalDraft(),
            baseRevision: "old-revision",
            draftId: "existing",
            messageId: "old-message",
          });
          await saving;
          blocked = await finishing;
        });
        expect(controller.state).toMatchObject({
          draft: { draftId: "restored", sendUncertain: false },
          open: true,
        });
        expect(controller.form.state.values.subject).toBe(
          "New canonical edits"
        );
        expect(blocked).toBe(action === "navigate" ? true : undefined);
        await vi.waitFor(async () => {
          const records = await draftRecoveryJournal
            .session("user", boundary.sessionId)
            .list({ mailboxId: "mailbox", userId: "user" });
          expect(
            records.some(
              (record) =>
                restoreComposeDraft(record.payload, record.editorId).subject ===
                "New canonical edits"
            )
          ).toBeTruthy();
        });
      }
    );

    it("does not transfer the former operation after sender files finish loading", async () => {
      await mount({
        ...initial(),
        assistantUnsaved: true,
        attachments: [
          {
            gmailAttachmentId: "provider-attachment",
            id: "notes",
            isInline: false,
            mimeType: "text/plain",
            name: "notes.txt",
            size: 5,
            sourceMessageId: "provider-message",
          },
        ],
      });
      const pendingFile =
        Promise.withResolvers<
          Awaited<ReturnType<typeof rpc.mail.getAttachment>>
        >();
      boundary.getAttachment.mockReturnValueOnce(pendingFile.promise);
      let transfer:
        | ReturnType<ComposeDialogController["prepareSenderSwitch"]>
        | undefined;
      await flush(() => {
        transfer = controller.prepareSenderSwitch();
      });
      await act(async () => {
        await readCompose().applyHeldReceipt(receiptFor());
        await controller.restoreHeldMessage();
      });
      await flush(() => {
        controller.form.setFieldValue("subject", "Current sender work");
      });
      await act(async () => {
        pendingFile.resolve({
          attachmentId: "provider-attachment",
          file: new File(["notes"], "notes.txt", { type: "text/plain" }),
          size: 5,
        });
        await expect(transfer).resolves.toBeNull();
      });
      expect(controller.state).toMatchObject({
        draft: { draftId: "restored", sendUncertain: false },
        open: true,
      });
      expect(controller.form.state.values.subject).toBe("Current sender work");
    });

    it("ignores a saved-tool receipt submitted before canonical Undo", async () => {
      await mount();
      const submitted = readCompose().read();
      await act(async () => {
        await readCompose().applyHeldReceipt(receiptFor());
        await controller.restoreHeldMessage();
      });
      await flush(() => {
        readCompose().applyReceipt({
          draftId: submitted.draftId,
          draftRevision: submitted.draftRevision,
          providerDraftId: "obsolete-draft",
          status: "draft_saved",
        });
      });
      const restored = canonicalDraft();
      expect(controller.state.draft).toMatchObject({
        baseRevision: restored.baseRevision,
        draftId: restored.draftId,
        messageId: restored.messageId,
        saveStatus: "saved",
      });
      expect(controller.form.state.values.subject).toBe(restored.subject);
    });
  });

  describe("assistant proposal persistence", () => {
    it("adopts unchanged persisted content on explicit Save and protects the next proposal", async () => {
      await mount({
        ...initial(),
        assistantUnsaved: true,
        draftId: "existing",
        saveStatus: "saved",
      });
      await act(async () => {
        await controller.saveDraft();
      });
      expect(controller.state.draft.assistantUnsaved).toBeFalsy();
      expect(boundary.saveDraft).not.toHaveBeenCalled();
      await flush(() => {
        readCompose().edit(
          { subject: "New proposal" },
          readCompose().read().draftRevision
        );
      });
      expect(controller.state.draft.assistantUnsaved).toBeTruthy();
      await act(async () => {
        await boundary.autosave?.();
      });
      expect(boundary.saveDraft).not.toHaveBeenCalled();
    });

    it("keeps edits, reminders, autosave, navigation and close local until an explicit save", async () => {
      await mount({
        ...initial(),
        assistantUnsaved: true,
        draftId: "existing",
      });
      await act(async () => {
        controller.handleUserDraftChange();
        controller.form.setFieldValue("subject", "Human refinement");
        controller.addAttachmentFiles([
          new File(["notes"], "notes.txt", { type: "text/plain" }),
        ]);
        controller.handleFollowUpReminderChange({
          condition: "No reply",
          dueAt: "2027-02-01T10:00:00Z",
          requestId: crypto.randomUUID(),
          timeZone: "UTC",
          title: "Follow up",
        });
        await boundary.autosave?.();
        await boundary.navigate?.();
      });
      expect(boundary.saveDraft).not.toHaveBeenCalled();
      expect(boundary.deleteDraft).not.toHaveBeenCalled();
      expect(controller.state.draft.assistantUnsaved).toBeTruthy();
      boundary.saveDraft.mockRejectedValueOnce(new Error("Offline"));
      await act(async () => {
        await controller.saveDraft();
      });
      expect(controller.state.draft.assistantUnsaved).toBeTruthy();
      await act(async () => {
        await controller.saveDraft();
      });
      expect(controller.state.draft.assistantUnsaved).toBeFalsy();
      await act(async () => {
        readCompose().edit(
          { subject: "Another proposal" },
          readCompose().read().draftRevision
        );
        await controller.closeComposeDialog();
      });
      expect(boundary.saveDraft).toHaveBeenCalledTimes(2);
      expect(controller.state.draft.assistantUnsaved).toBeTruthy();
    });

    it("preserves protection through sender transfer and lets a validated human send authorize persistence", async () => {
      await mount({
        ...initial(),
        assistantUnsaved: true,
        attachments: [
          {
            gmailAttachmentId: "provider-attachment",
            id: "notes",
            isInline: false,
            mimeType: "text/plain",
            name: "notes.txt",
            size: 5,
            sourceMessageId: "provider-message",
          },
        ],
      });
      let transfer: Awaited<
        ReturnType<ComposeDialogController["prepareSenderSwitch"]>
      > = null;
      await act(async () => {
        transfer = await controller.prepareSenderSwitch();
      });
      expect(transfer).toMatchObject({
        transferDraft: { assistantUnsaved: true },
      });
      expect(boundary.saveDraft).not.toHaveBeenCalled();
      expect(boundary.getAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          mailboxId: "mailbox",
          messageId: "provider-message",
        }),
        expect.anything()
      );
      await act(async () => {
        await controller.form.handleSubmit();
      });
      expect(boundary.sendMessage).toHaveBeenCalledOnce();
      expect(controller.state.draft).toMatchObject({
        assistantUnsaved: false,
        sendUncertain: true,
      });
    });

    it("does not let a stale save receipt authorize a later proposal", async () => {
      await mount({ ...initial(), assistantUnsaved: true });
      const old = readCompose().read();
      await flush(() => {
        readCompose().edit({ subject: old.values.subject }, old.draftRevision);
      });
      await flush(() => {
        readCompose().applyReceipt({
          draftId: old.draftId,
          draftRevision: old.draftRevision,
          providerDraftId: "saved",
          status: "draft_saved",
        });
      });
      expect(controller.state.draft.assistantUnsaved).toBeTruthy();
      expect(controller.state.draft.draftId).toBe("saved");
      await act(async () => {
        await boundary.autosave?.();
      });
      expect(boundary.saveDraft).not.toHaveBeenCalled();
    });
  });
});
