// @vitest-environment jsdom
import { setTimeout } from "node:timers/promises";

import type {
  CollaborationScope,
  CollaborationState,
} from "@quieter/mail/collaboration";
import type {
  CollaborationMentionsInput,
  CollaborationMentionsPage,
  CollaborationNote,
  CollaborationNoteParticipants,
  CollaborationNoteParticipantsInput,
  CollaborationNoteResult,
  CollaborationNotesPage,
} from "@quieter/mail/collaboration-notes";
import type { ButtonProps } from "@quieter/ui/button";
import type { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import type { Input } from "@quieter/ui/input";
import type {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createContext, useContext, useEffect, useMemo } from "react";
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

import { CollaborationMentions } from "./collaboration-mentions";
import { NoteParticipants } from "./note-participants";
import { useThreadNotes } from "./notes-query";
import { transitionNotesClient } from "./notes-session";

const server = vi.hoisted(() => ({
  get: vi.fn<() => Promise<CollaborationState>>(),
  mentions:
    vi.fn<
      (input: CollaborationMentionsInput) => Promise<CollaborationMentionsPage>
    >(),
  mutate: vi.fn<() => Promise<CollaborationNoteResult>>(),
  note: vi.fn<() => Promise<CollaborationNoteResult>>(),
  notes: vi.fn<() => Promise<CollaborationNotesPage>>(),
  participants:
    vi.fn<
      (
        input: CollaborationNoteParticipantsInput
      ) => Promise<CollaborationNoteParticipants>
    >(),
  toast: vi.fn<() => void>(),
}));

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      collaboration: {
        ...actual.rpc.collaboration,
        get: server.get,
        mentions: {
          ...actual.rpc.collaboration.mentions,
          list: server.mentions,
        },
        notes: {
          ...actual.rpc.collaboration.notes,
          get: server.note,
          list: server.notes,
          mutate: server.mutate,
          participants: server.participants,
        },
      },
    },
  };
});
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: server.toast,
}));

vi.mock(import("@quieter/ui/action-footer"), () => ({
  ActionFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));
vi.mock(import("@quieter/ui/button"), () => ({
  Button: ({ children, disabled, onClick }: ButtonProps) => (
    <button
      disabled={disabled}
      onClick={(event) => {
        onClick?.(Object.assign(event, { preventBaseUIHandler: () => {} }));
      }}
      type="button"
    >
      {children}
    </button>
  ),
}));
vi.mock(import("@quieter/ui/date-time-preferences"), () => ({
  useDateTimePreferences: () => ({ timeFormat: "24h", weekStartsOn: 1 }),
}));
vi.mock(import("@quieter/ui/pill"), () => ({
  Pill: ({ children }: ComponentProps<"span">) => <span>{children}</span>,
}));
vi.mock(import("@quieter/ui/input"), () => ({
  Input: ({
    "aria-label": label,
    placeholder,
    value,
  }: ComponentProps<typeof Input>) => (
    <input
      aria-label={label}
      placeholder={placeholder}
      readOnly
      value={value}
    />
  ),
}));
vi.mock(import("@quieter/ui/checkbox"), () => ({
  Checkbox: ({ checked, disabled }: ComponentProps<typeof Checkbox>) => (
    <input checked={checked} disabled={disabled} readOnly type="checkbox" />
  ),
  CheckboxIndicator: ({
    children,
  }: ComponentProps<typeof CheckboxIndicator>) => <span>{children}</span>,
}));
vi.mock(import("@quieter/ui/text"), () => ({
  Text: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));
vi.mock(import("@quieter/ui/popover"), () => {
  const Context = createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  }>({
    open: false,
    setOpen: vi.fn<(open: boolean) => void>(),
  });
  return {
    Popover: <Payload,>({
      children,
      onOpenChange,
      open = false,
    }: ComponentProps<typeof Popover<Payload>>) => {
      const value = useMemo(
        () => ({
          open,
          setOpen: (next: boolean) => {
            onOpenChange?.(next, {
              allowPropagation: () => {},
              cancel: () => {},
              event: new MouseEvent("click"),
              isCanceled: false,
              isPropagationAllowed: false,
              preventUnmountOnClose: () => {},
              reason: "trigger-press",
              trigger: undefined,
            });
          },
        }),
        [onOpenChange, open]
      );
      return (
        <Context.Provider value={value}>
          {typeof children === "function" ? null : children}
        </Context.Provider>
      );
    },
    PopoverContent: ({ children }: ComponentProps<typeof PopoverContent>) => {
      const value = useContext(Context);
      return <div hidden={!value.open}>{value.open ? children : null}</div>;
    },
    PopoverTitle: ({ children }: ComponentProps<typeof PopoverTitle>) => (
      <div>{children}</div>
    ),
    PopoverTrigger: ({ children }: ComponentProps<typeof PopoverTrigger>) => {
      const value = useContext(Context);
      return (
        <button
          onClick={() => {
            value.setOpen(!value.open);
          }}
          type="button"
        >
          {typeof children === "function" ? null : children}
        </button>
      );
    },
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("PointerEvent", MouseEvent);

const scope: CollaborationScope = {
  mailboxId: "shared-a",
  threadId: "thread-a",
};
const snapshot: CollaborationState = {
  ...scope,
  href: "/conversation",
  permissions: {
    assignOthers: true,
    claimSelf: true,
    moderateNotes: true,
    read: true,
    writeOwnNotes: true,
  },
  role: "manager",
  state: {
    cursor: {
      contextId: "a8ce9de4-f393-44bb-9c8c-ef77e25c5d87",
      revision: "1",
    },
    kind: "prepared",
  },
};
const cursor = {
  contextId: "a8ce9de4-f393-44bb-9c8c-ef77e25c5d87",
  revision: "1",
};
const readerSnapshot: CollaborationState = {
  ...snapshot,
  permissions: {
    assignOthers: false,
    claimSelf: false,
    moderateNotes: false,
    read: true,
    writeOwnNotes: false,
  },
  role: "reader",
};
const responderSnapshot: CollaborationState = {
  ...snapshot,
  permissions: {
    ...snapshot.permissions,
    assignOthers: false,
    moderateNotes: false,
  },
  role: "responder",
};
const note: CollaborationNote = {
  actions: { edit: true, remove: true },
  author: { kind: "member", memberId: "member-a", name: "Teammate" },
  body: "Saved team note",
  createdAt: "2026-11-16T12:00:00.000Z",
  id: "f79638ca-fb55-49be-bfde-adfa2e559bfd",
  mentions: [],
  updatedAt: "2026-11-16T12:00:00.000Z",
};

type Controller = ReturnType<typeof useThreadNotes>;
type ControllerRef = { current: Controller | null };

const NotesProbe = ({
  observe,
  input,
  withParticipants = false,
}: {
  observe: (notes: Controller) => void;
  input: CollaborationScope;
  withParticipants?: boolean;
}) => {
  const notes = useThreadNotes(input);
  useEffect(() => {
    observe(notes);
  }, [observe, notes]);
  const { attempt } = notes.client;
  return withParticipants &&
    notes.draftVisible &&
    attempt !== null &&
    attempt.kind !== "remove" ? (
    <NoteParticipants
      disabled={notes.writing}
      epoch={notes.epoch}
      onAccessLost={() => {
        notes.loseAccess(input);
      }}
      onChange={(mentions) => {
        notes.store.setState((current) =>
          transitionNotesClient(current, { kind: "change", mentions })
        );
      }}
      onSnapshot={notes.handleSnapshot}
      prefix={notes.prefix}
      scope={input}
      selected={attempt.mentions}
    />
  ) : null;
};

const fixtures: { dispose: () => void }[] = [];
const mount = async ({
  withMentions = false,
  withParticipants = false,
}: { withMentions?: boolean; withParticipants?: boolean } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const controller: ControllerRef = { current: null };
  const unrelated: ControllerRef = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const read = (ref = controller) => {
    if (ref.current === null) {
      throw new Error("Notes controller did not mount.");
    }
    return ref.current;
  };
  fixtures.push({
    dispose: () => {
      act(() => {
        root.unmount();
      });
      queryClient.clear();
      container.remove();
    },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NotesProbe
          observe={(notes) => {
            controller.current = notes;
          }}
          input={scope}
          withParticipants={withParticipants}
        />
        {withMentions ? (
          <>
            <NotesProbe
              observe={(notes) => {
                unrelated.current = notes;
              }}
              input={{ mailboxId: "shared-b", threadId: "thread-b" }}
            />
            <CollaborationMentions
              mailboxes={[{ label: "Shared", mailboxId: scope.mailboxId }]}
              onOpenConversation={vi.fn<(input: CollaborationScope) => void>()}
            />
          </>
        ) : null}
      </QueryClientProvider>
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await setTimeout(0);
    });
    expect(read().page).toBeDefined();
  });
  return { queryClient, read, unrelated };
};

const edit = async () => {
  const fixture = await mount();
  act(() => {
    fixture.read().startEdit(note, cursor);
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await setTimeout(0);
    });
    expect(fixture.read().draftVisible).toBeTruthy();
  });
  return fixture;
};

describe("internal notes client behavior", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    server.get.mockResolvedValue(snapshot);
    server.note.mockResolvedValue({ note, snapshot });
    server.notes.mockResolvedValue({ next: null, notes: [note], snapshot });
    server.mentions.mockResolvedValue({ mentions: [], next: null });
    server.participants.mockResolvedValue({
      nextMemberId: null,
      participants: [],
      snapshot,
    });
  });
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("note reload ownership", () => {
    test("a delayed reload cannot replace text typed after it started", async () => {
      const fixture = await edit();
      const pending = Promise.withResolvers<CollaborationNoteResult>();
      server.note.mockReturnValueOnce(pending.promise);
      const reload = fixture.read().reloadAttempt();
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Newer unsaved text",
            kind: "change",
          })
        );
      });
      await act(async () => {
        pending.resolve({
          note: { ...note, body: "Latest server text" },
          snapshot: {
            ...snapshot,
            state: { cursor: { ...cursor, revision: "2" }, kind: "prepared" },
          },
        });
        await reload;
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Newer unsaved text",
        expected: cursor,
      });
      expect(fixture.read().snapshot?.state).toMatchObject({ cursor });
    });

    test("a canceled reload cannot replace a newer edit of the same note", async () => {
      const fixture = await edit();
      const pending = Promise.withResolvers<CollaborationNoteResult>();
      server.note.mockReturnValueOnce(pending.promise);
      const reload = fixture.read().reloadAttempt();
      act(() => {
        fixture
          .read()
          .store.setState((current) =>
            transitionNotesClient(current, { kind: "cancel" })
          );
        fixture.read().startEdit(note, cursor);
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "New editing attempt",
            kind: "change",
          })
        );
      });
      await act(async () => {
        pending.resolve({
          note: { ...note, body: "Obsolete reload" },
          snapshot,
        });
        await reload;
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "New editing attempt",
        expected: cursor,
      });
    });

    test("canceling a pending reload does not resurrect its draft", async () => {
      const fixture = await edit();
      const pending = Promise.withResolvers<CollaborationNoteResult>();
      server.note.mockReturnValueOnce(pending.promise);
      const reload = fixture.read().reloadAttempt();
      act(() => {
        fixture
          .read()
          .store.setState((current) =>
            transitionNotesClient(current, { kind: "cancel" })
          );
      });
      await act(async () => {
        pending.resolve({ note, snapshot });
        await reload;
      });
      expect(fixture.read().client.attempt).toBeNull();
    });

    test("a stale reload error cannot hide a newer draft or emit an action error", async () => {
      const fixture = await edit();
      const { epoch } = fixture.read();
      const pending = Promise.withResolvers<CollaborationNoteResult>();
      server.note.mockReturnValueOnce(pending.promise);
      const reload = fixture.read().reloadAttempt();
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Keep this newer text",
            kind: "change",
          })
        );
      });
      await act(async () => {
        pending.reject(
          Object.assign(new Error("Access denied"), { code: "FORBIDDEN" })
        );
        await reload;
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Keep this newer text",
        expected: cursor,
      });
      expect(fixture.read().epoch).toBe(epoch);
      expect(fixture.read().draftVisible).toBeTruthy();
      expect(server.toast).not.toHaveBeenCalled();
    });

    test("an accepted explicit reload replaces text and captures the returned revision", async () => {
      const fixture = await edit();
      const latest = { ...cursor, revision: "2" };
      const result: CollaborationNoteResult = {
        note: { ...note, body: "Latest accepted text" },
        snapshot: { ...snapshot, state: { cursor: latest, kind: "prepared" } },
      };
      server.note.mockResolvedValue(result);
      server.notes.mockResolvedValue({
        next: null,
        notes: [note],
        snapshot: result.snapshot,
      });
      await act(async () => {
        await fixture.read().reloadAttempt();
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Latest accepted text",
        expected: latest,
      });
    });
  });

  describe("current note actions", () => {
    test("uncertain create validation closes a draft after write loss while other reads remain responder", async () => {
      const responder: CollaborationState = {
        ...snapshot,
        permissions: { ...snapshot.permissions, moderateNotes: false },
        role: "responder",
      };
      server.get.mockResolvedValue(responder);
      server.notes.mockResolvedValue({
        next: null,
        notes: [note],
        snapshot: responder,
      });
      const fixture = await mount();
      await act(async () => {
        await fixture.read().startCreate();
      });
      const reader: CollaborationState = {
        ...responder,
        permissions: {
          ...responder.permissions,
          claimSelf: false,
          writeOwnNotes: false,
        },
        role: "reader",
      };
      server.note.mockResolvedValue({ note: null, snapshot: reader });
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(
            transitionNotesClient(current, {
              body: "Uncertain create from previous role",
              kind: "change",
            }),
            { epoch: current.epoch, kind: "uncertain" }
          )
        );
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.attempt).toBeNull();
      });
      expect(fixture.read().snapshot?.role).toBe("responder");
      expect(fixture.read().draftVisible).toBeFalsy();
      expect(fixture.read().canWrite).toBeFalsy();
      expect(fixture.read().visible).toBeTruthy();
      expect(fixture.read().page?.notes).toContainEqual(
        expect.objectContaining({ body: note.body })
      );
      act(() => {
        fixture.read().save();
      });
      expect(server.mutate).not.toHaveBeenCalled();
      await act(async () => {
        await fixture.read().startCreate();
      });
      expect(fixture.read().client.attempt).toBeNull();
    });

    test("a reader page closes an existing create draft while authority still reports responder", async () => {
      const responder: CollaborationState = {
        ...snapshot,
        permissions: { ...snapshot.permissions, moderateNotes: false },
        role: "responder",
      };
      server.get.mockResolvedValue(responder);
      server.notes.mockResolvedValue({
        next: null,
        notes: [note],
        snapshot: responder,
      });
      const fixture = await mount();
      await act(async () => {
        await fixture.read().startCreate();
      });
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Draft from the previous write role",
            kind: "change",
          })
        );
      });
      expect(fixture.read().draftVisible).toBeTruthy();
      const reader: CollaborationState = {
        ...responder,
        permissions: {
          ...responder.permissions,
          claimSelf: false,
          writeOwnNotes: false,
        },
        role: "reader",
      };
      server.notes.mockResolvedValue({
        next: null,
        notes: [{ ...note, actions: { edit: false, remove: false } }],
        snapshot: reader,
      });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "notes"],
        });
      });
      await vi.waitFor(() => {
        expect(fixture.read().client.attempt).toBeNull();
      });
      expect(fixture.read().snapshot?.role).toBe("responder");
      expect(fixture.read().snapshot?.state).toMatchObject({ cursor });
      expect(fixture.read().draftVisible).toBeFalsy();
      expect(fixture.read().visible).toBeTruthy();
      expect(fixture.read().page?.notes).toContainEqual(
        expect.objectContaining({ body: note.body })
      );
      act(() => {
        fixture.read().save();
      });
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("a manager downgrade closes an off-page foreign-note removal at the same revision", async () => {
      const foreign = { ...note, actions: { edit: false, remove: true } };
      server.note.mockResolvedValue({ note: foreign, snapshot });
      server.notes.mockResolvedValue({ next: null, notes: [], snapshot });
      const fixture = await mount();
      act(() => {
        fixture.read().startRemove(foreign, cursor);
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().draftVisible).toBeTruthy();
      });
      const responder: CollaborationState = {
        ...snapshot,
        permissions: { ...snapshot.permissions, moderateNotes: false },
        role: "responder",
      };
      server.get.mockResolvedValue(responder);
      server.notes.mockResolvedValue({
        next: null,
        notes: [],
        snapshot: responder,
      });
      server.note.mockResolvedValue({
        note: { ...foreign, actions: { edit: false, remove: false } },
        snapshot: responder,
      });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.attempt).toBeNull();
      });
      expect(fixture.read().snapshot?.state).toMatchObject({ cursor });
      expect(fixture.read().draftVisible).toBeFalsy();
      act(() => {
        fixture.read().save();
      });
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("a current page denies an old-membership edit without changing role or revision", async () => {
      const fixture = await edit();
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Former membership draft",
            kind: "change",
          })
        );
      });
      server.note.mockReturnValue(
        Promise.withResolvers<CollaborationNoteResult>().promise
      );
      server.notes.mockResolvedValue({
        next: null,
        notes: [
          {
            ...note,
            actions: { edit: false, remove: true },
            author: { kind: "former-member" },
          },
        ],
        snapshot,
      });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "notes"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.attempt).toBeNull();
      });
      expect(fixture.read().snapshot?.state).toMatchObject({ cursor });
      expect(fixture.read().draftVisible).toBeFalsy();
    });

    test("an unchanged-revision list refresh rechecks an absent active target", async () => {
      const fixture = await edit();
      server.notes.mockResolvedValue({ next: null, notes: [], snapshot });
      server.note.mockResolvedValue({ note: null, snapshot });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "notes"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.attempt).toBeNull();
      });
      expect(fixture.read().snapshot?.state).toMatchObject({ cursor });
    });
  });

  describe("scoped permission observations", () => {
    test("participant reader evidence closes the draft and survives the picker disappearing", async () => {
      server.participants.mockResolvedValue({
        nextMemberId: null,
        participants: [],
        snapshot: readerSnapshot,
      });
      const fixture = await mount({ withParticipants: true });
      await act(async () => {
        await fixture.read().startCreate();
      });
      const trigger = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith("Notify teammates")
      );
      expect(trigger).toBeDefined();
      act(() => trigger?.click());
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.attempt).toBeNull();
      });
      expect(fixture.read().canWrite).toBeFalsy();
      expect(fixture.read().visible).toBeTruthy();
      expect(fixture.read().page?.notes).toContainEqual(
        expect.objectContaining({ body: note.body })
      );
      await act(async () => {
        await fixture.read().startCreate();
      });
      expect(fixture.read().client.attempt).toBeNull();
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("a canceled writer response and cached metadata cannot regrant writing but a fresh get can", async () => {
      const fixture = await edit();
      const pending = Promise.withResolvers<CollaborationState>();
      server.get.mockReturnValueOnce(pending.promise);
      act(() => {
        void fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(() => {
        expect(
          fixture.queryClient.isFetching({
            queryKey: [...fixture.read().prefix, "authority"],
          })
        ).toBeGreaterThan(0);
      });
      act(() => {
        fixture.read().handleSnapshot({
          epoch: fixture.read().epoch,
          snapshot: readerSnapshot,
        });
      });
      expect(fixture.read().canWrite).toBeFalsy();
      expect(fixture.read().client.attempt).toBeNull();
      await act(async () => {
        pending.resolve(snapshot);
        await pending.promise;
      });
      expect(fixture.read().canWrite).toBeFalsy();
      act(() => {
        for (const query of fixture.queryClient
          .getQueryCache()
          .findAll({ queryKey: [...fixture.read().prefix, "authority"] })) {
          fixture.queryClient.setQueryData(query.queryKey, snapshot);
        }
      });
      expect(fixture.read().canWrite).toBeFalsy();
      server.get.mockResolvedValue(responderSnapshot);
      server.notes.mockResolvedValue({
        next: null,
        notes: [note],
        snapshot: responderSnapshot,
      });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().canWrite).toBeTruthy();
      });
      expect(fixture.read().client.attempt).toBeNull();
      expect(fixture.read().visible).toBeTruthy();
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("a responder can regain writing while moderation stays unavailable", async () => {
      const fixture = await edit();
      act(() => {
        fixture.read().handleSnapshot({
          epoch: fixture.read().epoch,
          snapshot: readerSnapshot,
        });
      });
      expect(fixture.read().canWrite).toBeFalsy();
      const pending = Promise.withResolvers<CollaborationState>();
      server.get.mockResolvedValue(responderSnapshot);
      server.get.mockReturnValueOnce(pending.promise);
      act(() => {
        void fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(
          fixture.queryClient.isFetching({
            queryKey: [...fixture.read().prefix, "authority"],
          })
        ).toBeGreaterThan(0);
      });
      act(() => {
        fixture.read().handleSnapshot({
          epoch: fixture.read().epoch,
          snapshot: responderSnapshot,
        });
      });
      expect(fixture.read().canWrite).toBeFalsy();
      await act(async () => {
        pending.resolve(responderSnapshot);
        await pending.promise;
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().canWrite).toBeTruthy();
      });
      expect(fixture.read().canModerate).toBeFalsy();
      expect(fixture.read().client.attempt).toBeNull();
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("a page started before restored authority cannot discard a later draft", async () => {
      const fixture = await edit();
      act(() => {
        fixture.read().handleSnapshot({
          epoch: fixture.read().epoch,
          snapshot: readerSnapshot,
        });
      });
      const pending = Promise.withResolvers<CollaborationNotesPage>();
      server.notes.mockReturnValueOnce(pending.promise);
      act(() => {
        void fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "notes"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(
          fixture.queryClient.isFetching({
            queryKey: [...fixture.read().prefix, "private", "notes"],
          })
        ).toBeGreaterThan(0);
      });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().canWrite).toBeTruthy();
      });
      await act(async () => {
        await fixture.read().startCreate();
      });
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "New draft after role recovery",
            kind: "change",
          })
        );
      });
      await act(async () => {
        pending.resolve({
          next: null,
          notes: [{ ...note, actions: { edit: false, remove: false } }],
          snapshot: readerSnapshot,
        });
        await pending.promise;
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "New draft after role recovery",
        expected: cursor,
      });
      expect(fixture.read().draftVisible).toBeTruthy();
      expect(fixture.read().canWrite).toBeTruthy();
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("restoring moderation preserves the current author's unsaved draft", async () => {
      const fixture = await edit();
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Keep my edit through a role upgrade",
            kind: "change",
          })
        );
        fixture.read().handleSnapshot({
          epoch: fixture.read().epoch,
          snapshot: responderSnapshot,
        });
      });
      expect(fixture.read().canModerate).toBeFalsy();
      expect(fixture.read().draftVisible).toBeTruthy();
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().canModerate).toBeTruthy();
        expect(fixture.read().draftVisible).toBeTruthy();
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Keep my edit through a role upgrade",
        expected: cursor,
      });
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("retry recovery retires an older reader validation without losing the recovered edit", async () => {
      const fixture = await edit();
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Keep this recovered edit",
            kind: "change",
          })
        );
      });
      const pending = Promise.withResolvers<CollaborationNoteResult>();
      server.note.mockReturnValueOnce(pending.promise);
      act(() => {
        void fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "attempt"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(
          fixture.queryClient.isFetching({
            queryKey: [...fixture.read().prefix, "private", "attempt"],
          })
        ).toBeGreaterThan(0);
      });
      server.notes.mockRejectedValueOnce(new Error("Temporary read failure"));
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "notes"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.authority.kind).toBe("retry");
      });
      expect(fixture.read().draftVisible).toBeFalsy();
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Keep this recovered edit",
        expected: cursor,
      });
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().draftVisible).toBeTruthy();
      });
      await act(async () => {
        pending.resolve({
          note: { ...note, actions: { edit: false, remove: false } },
          snapshot: readerSnapshot,
        });
        await pending.promise;
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Keep this recovered edit",
        expected: cursor,
      });
      expect(fixture.read().draftVisible).toBeTruthy();
      expect(fixture.read().canWrite).toBeTruthy();
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test("explicit reader evidence during retry cancels the draft and an older pending get", async () => {
      const fixture = await edit();
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Hidden during the transient failure",
            kind: "change",
          })
        );
      });
      const pending = Promise.withResolvers<CollaborationState>();
      server.get.mockReturnValueOnce(pending.promise);
      act(() => {
        void fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "authority"],
        });
      });
      await vi.waitFor(() => {
        expect(
          fixture.queryClient.isFetching({
            queryKey: [...fixture.read().prefix, "authority"],
          })
        ).toBeGreaterThan(0);
      });
      server.notes.mockRejectedValueOnce(new Error("Temporary read failure"));
      await act(async () => {
        await fixture.queryClient.invalidateQueries({
          queryKey: [...fixture.read().prefix, "private", "notes"],
        });
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().client.authority.kind).toBe("retry");
      });
      expect(fixture.read().draftVisible).toBeFalsy();
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Hidden during the transient failure",
        expected: cursor,
      });
      act(() => {
        fixture.read().handleSnapshot({
          epoch: fixture.read().epoch,
          snapshot: readerSnapshot,
        });
      });
      expect(fixture.read().client.attempt).toBeNull();
      await act(async () => {
        pending.resolve(snapshot);
        await pending.promise;
      });
      expect(fixture.read().canWrite).toBeFalsy();
      expect(fixture.read().client.authority.kind).toBe("retry");
      expect(server.mutate).not.toHaveBeenCalled();
    });

    test.each(["foreign-remove", "own-remove", "own-edit"] as const)(
      "moderation loss applies to %s while authority and target validation are older",
      async (operation) => {
        const target = {
          ...note,
          actions: { edit: operation !== "foreign-remove", remove: true },
        };
        server.note.mockResolvedValue({ note: target, snapshot });
        server.notes.mockResolvedValue({ next: null, notes: [], snapshot });
        const fixture = await mount();
        act(() => {
          if (operation === "own-edit") {
            fixture.read().startEdit(target, cursor);
          } else {
            fixture.read().startRemove(target, cursor);
          }
        });
        await vi.waitFor(async () => {
          await act(async () => {
            await setTimeout(0);
          });
          expect(fixture.read().draftVisible).toBeTruthy();
        });
        server.notes.mockResolvedValue({
          next: null,
          notes: [],
          snapshot: responderSnapshot,
        });
        await act(async () => {
          await fixture.queryClient.invalidateQueries({
            queryKey: [...fixture.read().prefix, "private", "notes"],
          });
        });
        await vi.waitFor(async () => {
          await act(async () => {
            await setTimeout(0);
          });
          expect(fixture.read().canModerate).toBeFalsy();
          expect(fixture.read().draftVisible).toBe(
            operation !== "foreign-remove"
          );
          expect(fixture.read().client.attempt !== null).toBe(
            operation !== "foreign-remove"
          );
        });
        expect(fixture.read().canWrite).toBeTruthy();
        expect(fixture.read().visible).toBeTruthy();
        expect(server.mutate).not.toHaveBeenCalled();
      }
    );

    test("an old participant completion cannot discard a new epoch's draft", async () => {
      const pending = Promise.withResolvers<CollaborationNoteParticipants>();
      server.participants.mockReturnValueOnce(pending.promise);
      const fixture = await mount({ withParticipants: true });
      await act(async () => {
        await fixture.read().startCreate();
      });
      const trigger = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith("Notify teammates")
      );
      expect(trigger).toBeDefined();
      act(() => trigger?.click());
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(server.participants.mock.calls.length).toBeGreaterThan(0);
      });
      const online = vi.spyOn(navigator, "onLine", "get");
      online.mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      online.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await vi.waitFor(async () => {
        await act(async () => {
          await setTimeout(0);
        });
        expect(fixture.read().draftVisible).toBeTruthy();
      });
      act(() => {
        fixture
          .read()
          .store.setState((current) =>
            transitionNotesClient(current, { kind: "cancel" })
          );
      });
      await act(async () => {
        await fixture.read().startCreate();
      });
      act(() => {
        fixture.read().store.setState((current) =>
          transitionNotesClient(current, {
            body: "Draft after reconnect",
            kind: "change",
          })
        );
      });
      await act(async () => {
        pending.resolve({
          nextMemberId: null,
          participants: [],
          snapshot: readerSnapshot,
        });
        await pending.promise;
      });
      expect(fixture.read().client.attempt).toMatchObject({
        body: "Draft after reconnect",
        expected: cursor,
      });
      expect(fixture.read().draftVisible).toBeTruthy();
      expect(fixture.read().canWrite).toBeTruthy();
      expect(server.mutate).not.toHaveBeenCalled();
    });
  });

  test("reconnect hides a captured draft until authorization succeeds without discarding it", async () => {
    const fixture = await edit();
    act(() => {
      fixture.read().store.setState((current) =>
        transitionNotesClient(current, {
          body: "Keep this draft while checking access",
          kind: "change",
        })
      );
    });
    const pending = Promise.withResolvers<CollaborationState>();
    server.get.mockReturnValue(pending.promise);
    const online = vi.spyOn(navigator, "onLine", "get");
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(fixture.read().draftVisible).toBeFalsy();
    expect(fixture.read().client.attempt).toMatchObject({
      body: "Keep this draft while checking access",
      expected: cursor,
    });
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fixture.read().draftVisible).toBeFalsy();
    expect(fixture.read().client.attempt).toMatchObject({
      body: "Keep this draft while checking access",
      expected: cursor,
    });
    await act(async () => {
      pending.resolve(snapshot);
      await pending.promise;
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await setTimeout(0);
      });
      expect(fixture.read().draftVisible).toBeTruthy();
    });
    expect(fixture.read().client.attempt).toMatchObject({
      body: "Keep this draft while checking access",
      expected: cursor,
    });
    expect(server.mutate).not.toHaveBeenCalled();
  });

  test("polling closes an off-page edit when current membership loses authorship", async () => {
    vi.useFakeTimers({ toFake: ["clearInterval", "setInterval"] });
    server.notes.mockResolvedValue({ next: null, notes: [], snapshot });
    const fixture = await edit();
    server.note.mockResolvedValue({
      note: {
        ...note,
        actions: { edit: false, remove: true },
        author: { kind: "former-member" },
      },
      snapshot,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await setTimeout(0);
      });
      expect(fixture.read().client.attempt).toBeNull();
    });
    expect(fixture.read().snapshot?.state).toMatchObject({ cursor });
    expect(fixture.read().draftVisible).toBeFalsy();
  });

  test("a denied mention page closes matching sibling notes even when its head fails transiently", async () => {
    server.mentions.mockResolvedValue({
      mentions: [
        {
          ...scope,
          contextId: cursor.contextId,
          createdAt: note.createdAt,
          href: "/conversation",
          noteId: note.id,
        },
      ],
      next: { createdAt: note.createdAt, noteId: note.id },
    });
    const fixture = await mount({ withMentions: true });
    act(() => {
      fixture.read().startEdit(note, cursor);
      fixture.read(fixture.unrelated).startEdit(note, cursor);
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await setTimeout(0);
      });
      expect(fixture.read().draftVisible).toBeTruthy();
      expect(fixture.read(fixture.unrelated).draftVisible).toBeTruthy();
    });
    const trigger = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Mentions")
    );
    act(() => trigger?.click());
    const earlier = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Earlier mentions"
    );
    expect(earlier).toBeDefined();
    act(() => earlier?.click());
    await vi.waitFor(async () => {
      await act(async () => {
        await setTimeout(0);
      });
      expect(
        [...document.querySelectorAll("button")].some(
          (button) => button.textContent === "Latest"
        )
      ).toBeTruthy();
    });
    server.mentions.mockImplementation(
      async (input) =>
        await Promise.reject(
          Object.assign(new Error("Mention request failed"), {
            code:
              input.after === undefined ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          })
        )
    );
    const { prefix } = fixture.read();
    await act(async () => {
      await fixture.queryClient.invalidateQueries({
        queryKey: ["collaboration-notes", "mentions"],
      });
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await setTimeout(0);
      });
      expect(fixture.read().client.authority.kind).toBe("lost");
    });
    expect(fixture.read().client.attempt).toBeNull();
    expect(fixture.read().page).toBeUndefined();
    expect(
      fixture.queryClient
        .getQueryCache()
        .findAll({ queryKey: prefix })
        .filter((query) => query.state.data !== undefined)
    ).toHaveLength(0);
    expect(fixture.read(fixture.unrelated).client.attempt).toMatchObject({
      body: note.body,
    });
    expect(fixture.read(fixture.unrelated).draftVisible).toBeTruthy();
    expect(server.toast).not.toHaveBeenCalled();
  });
});
