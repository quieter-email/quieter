// @vitest-environment jsdom
import { AgentWorkspaceContext } from "@quieter/app/features/chat/domain/workspace-context";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vite-plus/test";

import { AgentWorkspaceProvider } from "./agent-workspace";
import type { WorkspaceBridge } from "./agent-workspace";

vi.mock(
  import("@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    useMailboxRouteSearch: () => ({
      activeMailbox: "inbox",
      calendarConnectionId: undefined,
      calendarDate: undefined,
      calendarEventId: undefined,
      calendarId: undefined,
      calendarTimeZone: undefined,
      calendarView: undefined,
      chatId: undefined,
      compose: undefined,
      gmailLink: undefined,
      isComposeMailbox: false,
      isScheduledMailbox: false,
      isSnippetMailbox: false,
      mailboxId: "fixture-mailbox",
      mailto: undefined,
      messageId: undefined,
      opensDefaultMailbox: false,
      query: "",
      setMailboxSearch: vi.fn<() => Promise<void>>().mockResolvedValue(),
      threadId: undefined,
      view: "inbox",
      workspace: undefined,
    }),
  })
);

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("PointerEvent", MouseEvent);

describe("manual workspace takeover", () => {
  test("keeps reading and copying passive while editing cancels the active run", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workspace: { current: WorkspaceBridge | null } = { current: null };
    const listeners = vi.spyOn(document, "addEventListener");
    try {
      act(() => {
        root.render(
          <AgentWorkspaceProvider
            mailboxId="fixture-mailbox"
            onComposeDraftRequested={vi.fn<() => void>()}
          >
            <AgentWorkspaceContext.Consumer>
              {(value) => {
                workspace.current = value;
                return null;
              }}
            </AgentWorkspaceContext.Consumer>
          </AgentWorkspaceProvider>
        );
      });
      const control = workspace.current?.control;
      if (control === undefined) {
        throw new Error("Workspace did not mount");
      }
      const listener = listeners.mock.calls.find(
        ([type]) => type === "keydown"
      )?.[1];
      if (typeof listener !== "function") {
        throw new TypeError("Workspace keyboard listener did not mount");
      }
      const generation = control.begin();
      for (const init of [
        { key: "PageDown" },
        { key: "Home" },
        { key: "ArrowDown" },
        { key: "Tab" },
        { key: " " },
        { key: "Backspace" },
        { key: "Delete" },
        { ctrlKey: true, key: "c" },
        { key: "a", metaKey: true },
        { ctrlKey: true, key: "f" },
        { key: "f", metaKey: true },
      ]) {
        const event = new KeyboardEvent("keydown", init);
        listener(
          new Proxy(event, {
            get(target, property): unknown {
              if (property === "isTrusted") {
                return true;
              }
              if (property === "target") {
                return document.body;
              }
              return Reflect.get(target, property, target);
            },
          })
        );
        expect(control.isCurrent(generation)).toBeTruthy();
      }
      const event = new KeyboardEvent("keydown", { key: "Backspace" });
      const input = document.createElement("input");
      container.append(input);
      listener(
        new Proxy(event, {
          get(target, property): unknown {
            if (property === "isTrusted") {
              return true;
            }
            if (property === "target") {
              return input;
            }
            return Reflect.get(target, property, target);
          },
        })
      );
      expect(control.isCurrent(generation)).toBeFalsy();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      listeners.mockRestore();
    }
  });
});
