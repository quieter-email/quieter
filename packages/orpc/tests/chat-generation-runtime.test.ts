import { describe, expect, test } from "vite-plus/test";

import {
  abortChatRun,
  registerChatRunController,
} from "../src/chat/generation/runtime";

describe("chat generation runtime", () => {
  test("aborts the active controller immediately", () => {
    const controller = new AbortController();
    const unregister = registerChatRunController("run-1", controller);

    expect(abortChatRun("run-1")).toBeTruthy();
    expect(controller.signal.aborted).toBeTruthy();

    unregister();
    expect(abortChatRun("run-1")).toBeFalsy();
  });

  test("does not let an older run unregister its replacement", () => {
    const first = new AbortController();
    const second = new AbortController();
    const unregisterFirst = registerChatRunController("run-2", first);
    const unregisterSecond = registerChatRunController("run-2", second);

    unregisterFirst();
    expect(abortChatRun("run-2")).toBeTruthy();
    expect(first.signal.aborted).toBeFalsy();
    expect(second.signal.aborted).toBeTruthy();
    unregisterSecond();
  });
});
