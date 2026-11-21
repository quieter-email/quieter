// @vitest-environment jsdom
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { CommandMenu } from "@quieter/ui/command-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@quieter/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vite-plus/test";

import { useMailboxCommands } from "../../mailbox/components/use-mailbox-commands";
import { useMessageListCommands } from "../../message-list/components/use-message-list-commands";
import type { AppCommand } from "../domain/app-commands";
import {
  CommandPaletteProvider,
  useRegisterCommands,
} from "./command-palette-context";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const noop = () => {
  // Fixture callback.
};

const setPaletteQuery = (value: string) => {
  const input = document.querySelector<HTMLInputElement>("[role='combobox']");
  if (input === null) {
    throw new Error("Search input did not mount.");
  }
  const valueDescriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  );
  valueDescriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
};

const LiveCommands = ({ commands }: { commands: readonly AppCommand[] }) => {
  useRegisterCommands(commands, "live-order");
  return null;
};

const ListFixture = ({
  listAction,
  onFocusSearch,
  scopeKey,
}: {
  listAction: () => void;
  onFocusSearch: () => void;
  scopeKey: string;
}) => {
  useMessageListCommands({
    actions: [
      {
        icon: CheckmarkCircle02Icon,
        id: "mark-threads-done",
        label: "Done",
        onSelect: listAction,
      },
    ],
    activeMailbox: "inbox",
    canFocusSearch: true,
    focusedSubject: "Quarterly plan",
    hasActiveMessage: false,
    hasFocusedThread: true,
    hasLabelTarget: true,
    hasNextConversation: false,
    hasPreviousConversation: false,
    hasUserLabels: true,
    isPending: false,
    isSelecting: false,
    loadedCount: 1,
    onClearSelection: noop,
    onFocusSearch,
    onOpenFocusedThread: noop,
    onOpenLabels: noop,
    onOpenNextConversation: noop,
    onOpenPreviousConversation: noop,
    onSelectAll: noop,
    onToggleFocusedSelection: noop,
    scopeKey,
    selectedCount: 0,
    supportsSelection: true,
  });
  return null;
};

const WorkspaceFixture = ({
  listAction,
  listScopeKey,
  mountList,
  onFocusSearch,
}: {
  listAction: () => void;
  listScopeKey: string;
  mountList: boolean;
  onFocusSearch: () => void;
}) => {
  useMailboxCommands({
    activeMailbox: "inbox",
    canCompose: true,
    isComposeMailbox: false,
    isMailWorkspace: true,
    isScheduledMailbox: false,
    isSnippetMailbox: false,
    isWorkspaceReady: true,
    mailboxes: [],
    onCompose: noop,
    onManageSnippets: noop,
    onOpenCalendar: noop,
    onOpenMail: noop,
    onSelectMailbox: noop,
    onSelectMailboxId: noop,
    onSelectView: noop,
    selectedMailboxId: "mailbox-1",
    selectedMailboxProvider: "gmail",
    view: "inbox",
  });
  return mountList ? (
    <ListFixture
      listAction={listAction}
      onFocusSearch={onFocusSearch}
      scopeKey={listScopeKey}
    />
  ) : null;
};

const ScopedCommands = ({
  onExecute,
  scope,
}: {
  onExecute: () => void;
  scope: string;
}) => {
  useRegisterCommands(
    [
      {
        execute: onExecute,
        group: "Mail",
        id: "fixture-action",
        label: "Fixture action",
        state: "available",
      },
    ],
    scope
  );
  return null;
};

describe("scoped command execution", () => {
  test("keeps an open context menu in charge without a popup button", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <ContextMenu>
                <ContextMenuTrigger id="fixture-context-target">
                  Fixture conversation
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem>Fixture action</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      const trigger = container.querySelector("#fixture-context-target");
      if (trigger === null) {
        throw new Error("The fixture did not mount.");
      }
      act(() => {
        trigger.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            button: 2,
            clientX: 10,
            clientY: 10,
          })
        );
      });
      await vi.waitFor(() => {
        expect(
          document.querySelector("[role='menu'][data-open]")
        ).not.toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("keeps a controlled confirmation in charge of keyboard input", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    const render = (confirmationOpen: boolean) => {
      root.render(
        <HotkeysProvider>
          <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
            <AlertDialog open={confirmationOpen}>
              <AlertDialogContent>
                <AlertDialogTitle>Fixture confirmation</AlertDialogTitle>
                <AlertDialogDescription>
                  Review the current action.
                </AlertDialogDescription>
              </AlertDialogContent>
            </AlertDialog>
          </CommandPaletteProvider>
        </HotkeysProvider>
      );
    };
    try {
      act(() => {
        render(true);
      });
      expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
      act(() => {
        render(false);
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[role='alertdialog']")).toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).not.toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("drops a pending action when its mailbox or selection changes before execution", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const previous = vi.fn<() => void>();
    const current = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const render = (scope: string, execute: () => void) => {
      root.render(
        <HotkeysProvider>
          <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
            <ScopedCommands onExecute={execute} scope={scope} />
          </CommandPaletteProvider>
        </HotkeysProvider>
      );
    };
    try {
      act(() => {
        render("mailbox-a:thread-a", previous);
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const option = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ].find((item) => item.textContent === "Fixture action");
      if (option === undefined) {
        throw new Error("The palette did not open.");
      }
      act(() => {
        option.click();
        render("mailbox-b:thread-b", current);
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[role='dialog']")).toBeNull();
      });
      expect(previous).not.toHaveBeenCalled();
      expect(current).not.toHaveBeenCalled();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      act(() => {
        [...document.querySelectorAll<HTMLButtonElement>("[role='option']")]
          .find((item) => item.textContent === "Fixture action")
          ?.click();
      });
      await vi.waitFor(() => {
        expect(current).toHaveBeenCalledOnce();
      });
      expect(previous).not.toHaveBeenCalled();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("toggles closed on Mod+Shift+K and matches multi-word queries with available actions first", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const markRead = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const MixedCommands = () => {
      useRegisterCommands(
        [
          {
            execute: () => {
              // Fixture action.
            },
            group: "Accounts",
            id: "switch-account",
            label: "Switch to Work",
            state: "available",
          },
          {
            group: "Conversation actions",
            id: "mark-archive",
            label: "Mark as Archived",
            reason: "Select a conversation first.",
            state: "unavailable",
          },
          {
            execute: markRead,
            group: "Conversation actions",
            id: "mark-read",
            label: "Mark as Read",
            shortcutId: "list-mark-read",
            state: "available",
          },
        ],
        "mixed"
      );
      return null;
    };
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <MixedCommands />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const options = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ];
      expect(options[0]?.textContent).toContain("Mark as Read");
      expect(options[1]?.textContent).toContain("Mark as Archived");

      const input =
        document.querySelector<HTMLInputElement>("[role='combobox']");
      if (input === null) {
        throw new Error("Search input did not mount.");
      }
      act(() => {
        const valueDescriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        );
        valueDescriptor?.set?.call(input, "mark read");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const filteredOptions = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ];
      expect(filteredOptions).toHaveLength(1);
      expect(filteredOptions[0]?.textContent).toContain("Mark as Read");

      const toggleCloseEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "K",
        shiftKey: true,
      });
      act(() => {
        document.dispatchEvent(toggleCloseEvent);
      });
      expect(toggleCloseEvent.defaultPrevented).toBeTruthy();
      await vi.waitFor(() => {
        expect(document.querySelector("[role='dialog']")).toBeNull();
      });
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("keeps an open popover in charge of keyboard input", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <Popover defaultOpen>
                <PopoverTrigger id="fixture-popover-trigger">
                  Inboxes
                </PopoverTrigger>
                <PopoverContent>Choose inboxes</PopoverContent>
              </Popover>
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      await vi.waitFor(() => {
        expect(
          document.querySelector("#fixture-popover-trigger[data-popup-open]")
        ).not.toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("ignores email subjects in description and ranks available label matches first", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onDone = vi.fn<() => void>();
    const onCalendar = vi.fn<() => void>();
    const onMail = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const SearchFixtures = () => {
      useRegisterCommands(
        [
          {
            description: "Focused conversation, Calendar review",
            execute: onDone,
            group: "Conversation actions",
            id: "mark-threads-done",
            label: "Done",
            state: "available",
          },
          {
            group: "Mail",
            id: "compose",
            label: "Compose",
            reason: "Open Mail first.",
            state: "unavailable",
          },
          {
            execute: onCalendar,
            group: "Navigation",
            id: "go-calendar",
            label: "Go to Calendar",
            state: "available",
          },
          {
            execute: onMail,
            group: "Navigation",
            id: "go-mail",
            label: "Go to Mail",
            state: "available",
          },
        ],
        "search-ranking"
      );
      return null;
    };
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <SearchFixtures />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      act(() => {
        const input = setPaletteQuery("calendar");
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          })
        );
      });
      await vi.waitFor(() => {
        expect(onCalendar).toHaveBeenCalledOnce();
      });
      expect(onDone).not.toHaveBeenCalled();

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      act(() => {
        const input = setPaletteQuery("mail");
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          })
        );
      });
      await vi.waitFor(() => {
        expect(onMail).toHaveBeenCalledOnce();
      });
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("defaults highlight to the first available command and keeps it pinned across live re-ordering", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onCompose = vi.fn<() => void>();
    const onMail = vi.fn<() => void>();
    const onMarkRead = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const baseCommands: AppCommand[] = [
      {
        group: "Conversation actions",
        id: "mark-threads-done",
        label: "Done",
        reason: "Select a conversation first.",
        state: "unavailable",
      },
      {
        execute: onCompose,
        group: "Mail",
        id: "compose",
        label: "Compose",
        state: "available",
      },
      {
        execute: onMail,
        group: "Navigation",
        id: "go-mail",
        label: "Go to Mail",
        state: "available",
      },
    ];
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <LiveCommands commands={baseCommands} />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const initialSelected = document.querySelector<HTMLButtonElement>(
        "[role='option'][aria-selected='true']"
      );
      expect(initialSelected?.textContent).toContain("Compose");

      const input =
        document.querySelector<HTMLInputElement>("[role='combobox']");
      if (input === null) {
        throw new Error("Search input did not mount.");
      }
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "ArrowDown",
          })
        );
      });
      expect(
        document.querySelector<HTMLButtonElement>(
          "[role='option'][aria-selected='true']"
        )?.textContent
      ).toContain("Go to Mail");

      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <LiveCommands
                commands={[
                  {
                    execute: onMarkRead,
                    group: "Conversation actions",
                    id: "mark-threads-read",
                    label: "Mark as Read",
                    state: "available",
                  },
                  ...baseCommands,
                ]}
              />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      expect(
        document.querySelector<HTMLButtonElement>(
          "[role='option'][aria-selected='true']"
        )?.textContent
      ).toContain("Go to Mail");

      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          })
        );
      });
      await vi.waitFor(() => {
        expect(onMail).toHaveBeenCalledOnce();
      });
      expect(onCompose).not.toHaveBeenCalled();
      expect(onMarkRead).not.toHaveBeenCalled();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("blocks opening over popup CommandMenu and triggerless controlled Popover", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <CommandMenu
                activeIndex={0}
                chrome="popup"
                id="fixture-slash-menu"
                items={[{ group: "Format", id: "h1", label: "Heading 1" }]}
                onHighlight={noop}
                onSelect={noop}
              />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();

      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <Popover open>
                <PopoverContent>Controlled overlay</PopoverContent>
              </Popover>
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      await vi.waitFor(() => {
        expect(
          document.querySelector("[data-popover-popup][data-open]")
        ).not.toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("skips restoring trigger focus on command execution and cancels pending dispatch on reopen", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onExecute = vi.fn<() => void>();
    const onTriggerFocus = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((frameFn) => {
        const id = nextFrameId;
        nextFrameId += 1;
        queuedFrames.set(id, frameFn);
        return id;
      });
    const cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        queuedFrames.delete(id);
      });
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <button
                id="fixture-focus-source"
                onFocus={onTriggerFocus}
                type="button"
              >
                Search bar
              </button>
              <ScopedCommands onExecute={onExecute} scope="focus-test" />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      const trigger = container.querySelector<HTMLButtonElement>(
        "#fixture-focus-source"
      );
      if (trigger === null) {
        throw new Error("Focus fixture did not mount.");
      }
      act(() => {
        trigger.focus();
      });
      onTriggerFocus.mockClear();

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      act(() => {
        [...document.querySelectorAll<HTMLButtonElement>("[role='option']")]
          .find((item) => item.textContent === "Fixture action")
          ?.click();
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[role='dialog']")).toBeNull();
      });
      expect(onTriggerFocus).not.toHaveBeenCalled();

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      act(() => {
        for (const runFrame of queuedFrames.values()) {
          runFrame(0);
        }
      });
      expect(onExecute).not.toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("overrides fallback Search mail with real list commands and drops stale list actions on scope change", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    const onFocusSearch = vi.fn<() => void>();
    const onDoneStale = vi.fn<() => void>();
    const onDoneCurrent = vi.fn<() => void>();

    const renderFixture = (
      mountList: boolean,
      listScopeKey: string,
      listAction: () => void
    ) => {
      root.render(
        <HotkeysProvider>
          <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
            <WorkspaceFixture
              listAction={listAction}
              listScopeKey={listScopeKey}
              mountList={mountList}
              onFocusSearch={onFocusSearch}
            />
          </CommandPaletteProvider>
        </HotkeysProvider>
      );
    };

    try {
      act(() => {
        renderFixture(true, "scope-a", onDoneStale);
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const searchOptions = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ].filter((item) => item.textContent?.includes("Search mail"));
      expect(searchOptions).toHaveLength(1);
      expect(searchOptions[0]?.getAttribute("aria-disabled")).toBeNull();

      const doneOption = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ].find((item) => item.textContent?.includes("Done"));
      if (doneOption === undefined) {
        throw new Error("List action did not register.");
      }
      act(() => {
        doneOption.click();
        renderFixture(true, "scope-b", onDoneCurrent);
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[role='dialog']")).toBeNull();
      });
      expect(onDoneStale).not.toHaveBeenCalled();
      expect(onDoneCurrent).not.toHaveBeenCalled();

      act(() => {
        renderFixture(false, "scope-b", onDoneCurrent);
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const fallbackSearchOptions = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ].filter((item) => item.textContent?.includes("Search mail"));
      expect(fallbackSearchOptions).toHaveLength(1);
      expect(fallbackSearchOptions[0]?.getAttribute("aria-disabled")).toBe(
        "true"
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
