import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

type CaptureScenario = {
  name: string;
  path: string;
  ready: string;
  steps?: readonly (readonly string[])[];
  full?: boolean;
};

const [phase, originValue = "http://localhost:3024", outputValue] = process.argv
  .slice(2)
  .filter((value) => value !== "--contrast-only");
if (phase !== "before" && phase !== "after") {
  throw new Error("Choose before or after as the first argument.");
}
const origin = new URL(originValue);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  origin.protocol !== "http:"
) {
  throw new Error("Capture requires a loopback development server.");
}
const output = path.resolve(
  outputValue ?? `docs/reviews/product-visual-refinement/${phase}`
);
mkdirSync(output, { recursive: true });
const session = `quieter-visual-review-${phase}`;
const contrastOnly = process.argv.includes("--contrast-only");

const browser = (...args: readonly string[]) => {
  try {
    return execFileSync(
      "vp",
      ["dlx", "--", "agent-browser@0.39.2", "--session", session, ...args],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      process.stderr.write(String(error.stderr));
    }
    throw error;
  }
};

const scenarios: readonly CaptureScenario[] = [
  {
    name: "inbox",
    path: "/?mailbox=inbox&mailboxId=demo%3Amailbox",
    ready: '[aria-label^="Open conversation:"]',
  },
  {
    name: "conversation",
    path: "/?mailboxId=demo%3Amailbox&messageId=demo-stripe-1&threadId=demo-stripe-1",
    ready: "h1",
  },
  {
    name: "compose",
    path: "/?mailbox=compose&mailboxId=demo%3Amailbox",
    ready: '[contenteditable="true"]',
    steps: [
      [
        "find",
        "role",
        "textbox",
        "fill",
        "alex@example.test",
        "--name",
        "To",
        "--exact",
      ],
      ["press", "Tab"],
      [
        "find",
        "role",
        "textbox",
        "fill",
        "Notes for the autumn launch",
        "--name",
        "Subject",
        "--exact",
      ],
      [
        "fill",
        '[contenteditable="true"]',
        "Hi Alex,\n\nThe launch notes are ready for your review. I have included the updated timeline and the feedback from our last conversation.\n\nThanks,\nSam",
      ],
    ],
  },
  {
    name: "search",
    path: "/?mailboxId=demo%3Amailbox&query=has%3Aattachment",
    ready: '[aria-label^="Open conversation:"]',
  },
  {
    name: "labels",
    path: "/?view=labels&mailboxId=demo%3Amailbox",
    ready: "h1",
  },
  {
    name: "label-dialog",
    path: "/?view=labels&mailboxId=demo%3Amailbox",
    ready: "h1",
    steps: [
      ["find", "role", "button", "click", "--name", "New label", "--exact"],
      ["wait", '[role="dialog"]'],
      ["find", "label", "Name", "fill", "Project notes", "--exact"],
    ],
  },
  {
    name: "snippets",
    path: "/?mailbox=snippets&mailboxId=demo%3Amailbox",
    ready: 'input[placeholder="Search snippets"]',
  },
  {
    name: "snippet-dialog",
    path: "/?mailbox=snippets&mailboxId=demo%3Amailbox",
    ready: 'input[placeholder="Search snippets"]',
    steps: [
      ["find", "role", "button", "click", "--name", "New", "--exact"],
      ["wait", '[role="dialog"]'],
    ],
  },
  {
    name: "preferences",
    path: "/settings?tab=overview",
    ready: '[aria-label="Theme"]',
  },
  {
    name: "shortcuts",
    path: "/settings?tab=overview",
    ready: '[aria-label="Theme"]',
    steps: [
      ["find", "role", "button", "click", "--name", "View", "--exact"],
      ["wait", '[role="dialog"]'],
    ],
  },
  { name: "account", path: "/settings?tab=account", ready: "h1" },
  { name: "connections", path: "/settings?tab=connectors", ready: "h1" },
  { name: "mailboxes", path: "/settings?tab=mailboxes", ready: "h1" },
  {
    name: "add-mailbox",
    path: "/settings?tab=mailboxes&mailboxView=add",
    ready: "h1",
  },
  {
    name: "assistant",
    path: "/?mailbox=inbox&mailboxId=demo%3Amailbox",
    ready: '[aria-label^="Open conversation:"]',
    steps: [
      [
        "find",
        "role",
        "button",
        "click",
        "--name",
        "Expand assistant sidebar",
        "--exact",
      ],
      ["wait", '[aria-label="Collapse assistant sidebar"]'],
    ],
  },
  { full: true, name: "components", path: "/design-system", ready: "h1" },
];

const captures: string[] = [];
const capture = ({
  scenario,
  theme,
  narrow = false,
}: {
  scenario: CaptureScenario;
  theme: "light" | "dark";
  narrow?: boolean;
}) => {
  browser("set", "viewport", narrow ? "390" : "1440", narrow ? "844" : "960");
  browser("set", "media", theme, "reduced-motion");
  browser(
    "eval",
    `localStorage.setItem("quieter-color-mode", ${JSON.stringify(theme)}); localStorage.removeItem("quieter-theme-light"); localStorage.removeItem("quieter-theme-dark"); localStorage.setItem("quieter:assistant-sidebar-closed", "true");`
  );
  browser("open", new URL(scenario.path, origin).href);
  browser("wait", scenario.ready);
  browser(
    "wait",
    "--fn",
    "!document.querySelector('[aria-label^=\"Loading\"]') && !document.body.innerText.includes('Loading teams')"
  );
  for (const step of scenario.steps ?? []) {
    browser(...step);
  }
  browser(
    "wait",
    "--fn",
    "document.fonts.status === 'loaded' && !document.querySelector('[data-starting-style]')"
  );
  browser("eval", "document.activeElement?.blur(); window.scrollTo(0, 0)");
  const name = `${scenario.name}-${theme}${narrow ? "-narrow" : ""}.png`;
  browser(
    "screenshot",
    ...(scenario.full === true ? ["--full"] : []),
    path.resolve(output, name)
  );
  captures.push(name);
  process.stdout.write(`${phase} ${name}\n`);
};

try {
  browser("close");
  browser("set", "media", "light", "reduced-motion");
  if (!contrastOnly) {
    browser("set", "viewport", "1440", "960");
    browser("set", "media", "light", "reduced-motion");
    browser("open", new URL("/auth", origin).href);
    browser("wait", "--text", "User with Gmail");
    browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Reject All",
      "--exact"
    );
    browser(
      "wait",
      "--fn",
      "!document.querySelector('[aria-label=\"Cookie consent\"]')"
    );
    browser("screenshot", path.resolve(output, "auth-dark.png"));
    captures.push("auth-dark.png");
    browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "User with Gmail",
      "--exact"
    );
    browser("wait", '[aria-label^="Open conversation:"]');
    if (phase === "after") {
      browser("open", new URL("/settings?tab=overview", origin).href);
      browser("wait", '[aria-label="Mail layout"]');
      browser("click", '[aria-label="Mail layout"]');
      browser(
        "find",
        "role",
        "option",
        "click",
        "--name",
        "Two panels",
        "--exact"
      );
    }
    for (const theme of ["light", "dark"] as const) {
      for (const scenario of scenarios) {
        capture({ scenario, theme });
      }
    }
    for (const name of [
      "inbox",
      "conversation",
      "compose",
      "preferences",
      "label-dialog",
    ]) {
      const scenario = scenarios.find((item) => item.name === name);
      if (!scenario) {
        throw new Error(`Missing capture scenario ${name}.`);
      }
      capture({
        narrow: true,
        scenario,
        theme: name === "compose" || name === "preferences" ? "dark" : "light",
      });
    }
    if (phase === "after") {
      browser("set", "viewport", "1440", "960");
      browser("open", new URL("/settings?tab=overview", origin).href);
      browser("wait", '[aria-label="Mail layout"]');
      browser("click", '[aria-label="Mail layout"]');
      browser(
        "find",
        "role",
        "option",
        "click",
        "--name",
        "One panel",
        "--exact"
      );
      for (const theme of ["light", "dark"] as const) {
        for (const scenario of scenarios.filter((item) =>
          ["inbox", "conversation"].includes(item.name)
        )) {
          capture({
            scenario: { ...scenario, name: `one-panel-${scenario.name}` },
            theme,
          });
        }
      }
      for (const scenario of [
        {
          name: "one-panel-unified-inbox",
          path: "/?view=all-inboxes&mailbox=inbox&mailboxId=demo%3Amailbox",
          ready: '[aria-label^="Open conversation:"]',
        },
        {
          name: "one-panel-unified-conversation",
          path: "/?view=all-inboxes&mailboxId=demo%3Amailbox&messageId=demo-stripe-1&threadId=demo-stripe-1",
          ready: "article h1",
        },
        {
          name: "mail-layout-options",
          path: "/settings?tab=overview",
          ready: '[aria-label="Mail layout"]',
          steps: [["click", '[aria-label="Mail layout"]']],
        },
        {
          name: "one-panel-selected-important",
          path: "/?mailbox=inbox&mailboxId=demo%3Amailbox",
          ready: '[aria-label^="Open conversation:"]',
          steps: [
            ["click", 'li[data-index="0"] [aria-label="Select conversation"]'],
          ],
        },
        {
          name: "message-controls",
          path: "/?mailboxId=demo%3Amailbox&messageId=demo-slack-1&threadId=demo-slack-1",
          ready: '[aria-label="Unsubscribe"]',
        },
        {
          name: "message-controls-requested",
          path: "/?mailboxId=demo%3Amailbox&messageId=demo-slack-1&threadId=demo-slack-1",
          ready: '[aria-label="Unsubscribe"]',
          steps: [
            ["click", '[aria-label="Unsubscribe"]'],
            ["wait", '[aria-label="Unsubscribe requested"]'],
            ["click", '[aria-label="Mark message as important"]'],
            ["wait", '[aria-label="Mark message as not important"]'],
          ],
        },
        {
          name: "one-panel-inbox-assistant",
          path: "/?mailbox=inbox&mailboxId=demo%3Amailbox",
          ready: '[aria-label^="Open conversation:"]',
          steps: [
            [
              "find",
              "role",
              "button",
              "click",
              "--name",
              "Expand assistant sidebar",
              "--exact",
            ],
            ["wait", '[aria-label="Collapse assistant sidebar"]'],
          ],
        },
      ] satisfies readonly CaptureScenario[]) {
        capture({ scenario, theme: "light" });
      }
    }
    browser("cookies", "clear");
    browser("eval", "localStorage.clear()");
    browser("set", "viewport", "1440", "960");
    browser("open", new URL("/auth", origin).href);
    browser("wait", "--text", "Onboarding user");
    browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Onboarding user",
      "--exact"
    );
    browser("wait", "--text", "What brings you here");
    browser("screenshot", path.resolve(output, "onboarding-dark.png"));
    captures.push("onboarding-dark.png");
    if (phase === "after") {
      browser("find", "label", "Name", "fill", "Sam Rivera", "--exact");
      browser("find", "role", "button", "click", "--name", "Finish", "--exact");
      browser("wait", "--text", "Connect a mailbox");
      browser("set", "media", "dark", "reduced-motion");
      browser("eval", 'localStorage.setItem("quieter-color-mode", "dark")');
      browser("open", origin.href);
      browser(
        "find",
        "role",
        "button",
        "click",
        "--name",
        "Set up managed mail Use your own domain with managed mailboxes and API keys.",
        "--exact"
      );
      browser("wait", "--text", "Choose managed access");
      browser("set", "viewport", "390", "844");
      browser(
        "screenshot",
        path.resolve(output, "managed-setup-dark-narrow.png")
      );
      captures.push("managed-setup-dark-narrow.png");
    }
  }
  browser("open", new URL("/design-system", origin).href);
  browser("wait", "h1");
  browser(
    "wait",
    "--fn",
    "getComputedStyle(document.documentElement).getPropertyValue('--q-blue').trim() !== '' && document.fonts.status === 'loaded'"
  );
  const contrast = z
    .object({
      data: z.object({
        result: z.looseObject({ failures: z.array(z.unknown()) }),
      }),
      success: z.literal(true),
    })
    .parse(
      JSON.parse(
        browser(
          "eval",
          "--json",
          readFileSync(
            new URL("measure-product-contrast.js", import.meta.url),
            "utf-8"
          )
        )
      )
    );
  writeFileSync(
    path.resolve(output, "contrast.json"),
    `${JSON.stringify(contrast.data.result, null, 2)}\n`
  );
  if (contrast.data.result.failures.length > 0) {
    throw new Error(JSON.stringify(contrast.data.result.failures));
  }
  if (!contrastOnly) {
    writeFileSync(
      path.resolve(output, "captures.json"),
      `${JSON.stringify({ captures, origin: origin.origin, phase }, null, 2)}\n`
    );
  }
} finally {
  browser("close");
}
