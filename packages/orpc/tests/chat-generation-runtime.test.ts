import { describe, expect, test } from "vite-plus/test";
import { abortChatRun, registerChatRunController } from "../src/chat/generation/runtime";

describe("chat generation runtime", () => {
  test("aborts the active controller immediately", () => {
    const controller = new AbortController();
    const unregister = registerChatRunController("run-1", controller);

    expect(abortChatRun("run-1")).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    unregister();
    expect(abortChatRun("run-1")).toBe(false);
  });

  test("does not let an older run unregister its replacement", () => {
    const first = new AbortController();
    const second = new AbortController();
    const unregisterFirst = registerChatRunController("run-2", first);
    const unregisterSecond = registerChatRunController("run-2", second);

    unregisterFirst();
    expect(abortChatRun("run-2")).toBe(true);
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(true);
    unregisterSecond();
  });
});
