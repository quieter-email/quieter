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
  it("renders images inert and keeps only intentional safe links and valid mail references interactive", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(
          <MarkdownContent
            markdown={[
              "![Private image](https://tracker.invalid/pixel?secret=fixture)",
              '<img src="https://tracker.invalid/html-pixel" onerror="alert(1)">',
              '<iframe src="https://tracker.invalid/frame"></iframe>',
              String.raw`$\includegraphics{https://tracker.invalid/math-pixel}$`,
              String.raw`$\href{https://tracker.invalid/math-link}{Untrusted link}$`,
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

  it("renders inline and display equations while keeping code literal", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(
          <MarkdownContent
            markdown={[
              String.raw`The slope is $\frac{\Delta y}{\Delta x}$.`,
              "",
              "$$",
              String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`,
              "$$",
              "",
              "Inline code: `$x^2$`.",
              "",
              "```text",
              "$$ x^2 $$",
              "```",
            ].join("\n")}
          />
        );
      });
      expect(container.querySelectorAll("math")).toHaveLength(2);
      expect(container.querySelector("p math mfrac")).not.toBeNull();
      expect(container.querySelector("math[display='block']")).not.toBeNull();
      expect(container.querySelector("p code")?.textContent).toBe("$x^2$");
      expect(container.querySelector("pre code")?.textContent).toContain(
        "$$ x^2 $$"
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("keeps streaming text visible while an equation is incomplete", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(
          <MarkdownContent markdown={"Here is the ratio.\n\n$$\n\\frac{"} />
        );
      });
      expect(container.textContent).toContain("Here is the ratio.");

      act(() => {
        root.render(
          <MarkdownContent
            markdown={"Here is the ratio.\n\n$$\n\\frac{1}{2}\n$$"}
          />
        );
      });
      expect(
        container.querySelector("math[display='block'] mfrac")
      ).not.toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("preserves prices and escaped dollars next to inline math", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(
          <MarkdownContent
            markdown={[
              "The estimates range from $10 to $20 or $30–$50.",
              "The fee is $10. Calculate $2 + 2$ next.",
              "The escaped price is \\$15. The command is `printf '$20'`.",
              "The total is US$ 500. The variable is $x^2$.",
            ].join("\n\n")}
          />
        );
      });
      expect(container.textContent).toContain(
        "The estimates range from $10 to $20 or $30–$50."
      );
      expect(container.textContent).toContain("The fee is $10.");
      expect(container.textContent).toContain("The escaped price is $15.");
      expect(container.textContent).toContain("The total is US$ 500.");
      expect(container.querySelector("code")?.textContent).toBe("printf '$20'");
      expect(
        [...container.querySelectorAll("math annotation")].map(
          (annotation) => annotation.textContent
        )
      ).toStrictEqual(["2 + 2", "x^2"]);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
