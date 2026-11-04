// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { MarkdownContent } from "./markdown-content";

vi.mock(import("@quieter/app/features/chat/components/mail-reference"), () => ({
  MailReference: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

// React needs this flag when driving the real renderer outside a test adapter.
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

describe("assistant Markdown", () => {
  it("renders images inert and keeps only intentional safe links and valid mail references interactive", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <MarkdownContent
            markdown={[
              "![Private image](https://tracker.invalid/pixel?secret=fixture)",
              '<img src="https://tracker.invalid/html-pixel" onerror="alert(1)">',
              '<iframe src="https://tracker.invalid/frame"></iframe>',
              "[Unsafe](javascript:alert%281%29)",
              "[Data](data:text/html,hello)",
              "[Relative](//tracker.invalid/relative)",
              "[Web](https://example.invalid/page)",

              "[Email](mailto:fixture@example.invalid)",
              "[Message](/mail-reference?messageId=message-1)",
              "[Invalid message](/mail-reference?messageId=message-1&unexpected=value)",
            ].join("\n\n")}
          />
        );
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Private image");
      expect(container.querySelector("img, iframe, script")).toBeNull();
      expect(
        [...container.querySelectorAll("a")].map((link) =>
          link.getAttribute("href")
        )
      ).toStrictEqual([
        "https://example.invalid/page",
        "mailto:fixture@example.invalid",
      ]);
      expect(container.querySelector("button")?.textContent).toBe("Message");
      expect(container.textContent).toContain("Invalid message");
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
