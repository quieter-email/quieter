import { setImmediate } from "node:timers/promises";

import { describe, expect, test, vi } from "vite-plus/test";

import {
  loadChatView,
  loadComposeWorkspace,
  loadSnippetWorkspace,
} from "./workspace-component-loaders";

vi.mock(import("@quieter/app/features/chat/components/chat-view"), () => {
  throw new Error("The assistant module could not load.");
});

vi.mock(
  import("@quieter/app/features/compose/components/compose-workspace"),
  () => {
    throw new Error("The compose module could not load.");
  }
);

vi.mock(
  import("@quieter/app/features/compose/components/snippet-workspace"),
  () => {
    throw new Error("The snippets module could not load.");
  }
);

describe("workspace component loading", () => {
  test.each([
    ["assistant", loadChatView],
    ["compose", loadComposeWorkspace],
    ["snippets", loadSnippetWorkspace],
  ] as const)(
    "keeps ignored %s prewarm failures observable to mounted consumers",
    async (_workspace, load) => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const loading = load();
        await setImmediate();
        await expect(loading).rejects.toBeInstanceOf(Error);
        expect(unhandled).toHaveLength(0);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    }
  );
});
