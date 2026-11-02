import { Chat } from "@ai-sdk/react";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  decodeChatStreamError,
  encodeChatExpectedError,
} from "@quieter/orpc/chat-errors";
import type * as ToastModule from "@quieter/ui/toast";
import type * as SentryModule from "@sentry/react";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  DefaultChatTransport,
} from "ai";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn<(message: string) => void>(),
  message: vi.fn<(message: string) => void>(),
  success: vi.fn<(message: string) => void>(),
}));

const sentryMocks = vi.hoisted(() => ({
  captureException:
    vi.fn<(error: unknown, hint?: { tags: { boundary: string } }) => void>(),
}));

vi.mock(
  import("@quieter/ui/toast"),
  () =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock shape is partial by design
    ({ toast: toastMocks }) as unknown as typeof ToastModule
);
vi.mock(
  import("@sentry/react"),
  () =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock shape is partial by design
    sentryMocks as unknown as typeof SentryModule
);

const GMAIL_REAUTHORIZATION_MESSAGE =
  "Google access needs to be reconnected for this mailbox.";

describe(toastError, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows the server message for a top-level 4xx error", () => {
    toastError(
      Object.assign(new Error("AI features require an upgrade."), {
        status: 403,
      }),
      { fallback: "Generic text." }
    );

    expect(toastMocks.error).toHaveBeenCalledWith(
      "AI features require an upgrade."
    );
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  test("walks the cause chain to find a 4xx status", () => {
    const cause = Object.assign(new Error("Not enough credits."), {
      status: 402,
    });
    toastError(new Error("Wrapped", { cause }));

    expect(toastMocks.error).toHaveBeenCalledWith("Not enough credits.");
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  test("falls back and reports for status-less errors", () => {
    toastError(new TypeError("Failed to fetch"), { boundary: "test-boundary" });

    expect(toastMocks.error).toHaveBeenCalledWith(
      "Something went wrong. Please try again."
    );
    expect(sentryMocks.captureException).toHaveBeenCalledOnce();
    const captured = sentryMocks.captureException.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(TypeError);
    const hint = sentryMocks.captureException.mock.calls[0]?.[1];
    expect(hint?.tags.boundary).toBe("test-boundary");
  });

  test("can skip client reporting for a redacted callback result already reported by the server", () => {
    toastError(undefined, { report: false });

    expect(toastMocks.error).toHaveBeenCalledOnce();
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  test("falls back and reports for 5xx statuses", () => {
    toastError(Object.assign(new Error("Boom."), { status: 500 }));

    expect(toastMocks.error).toHaveBeenCalledWith(
      "Something went wrong. Please try again."
    );
    expect(sentryMocks.captureException).toHaveBeenCalledOnce();
  });

  test("suppresses reporting for expected client errors", () => {
    toastError(new Error(GMAIL_REAUTHORIZATION_MESSAGE));

    expect(toastMocks.error).toHaveBeenCalledWith(
      "Something went wrong. Please try again."
    );
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  test("terminates on circular cause chains", () => {
    const first: { cause?: unknown } = new Error("First");
    const second: { cause?: unknown } = new Error("Second");
    first.cause = second;
    second.cause = first;

    expect(() => {
      toastError(first);
    }).not.toThrow();

    expect(toastMocks.error).toHaveBeenCalledWith(
      "Something went wrong. Please try again."
    );
    expect(sentryMocks.captureException).toHaveBeenCalledOnce();
  });
});

describe("chat stream error transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("preserves actionable errors through the real SDK stream without reporting", async () => {
    const message = "Add credits before continuing.";
    const chat = new Chat({
      onError: (error) => {
        toastError(decodeChatStreamError(error));
      },
      transport: new DefaultChatTransport({
        fetch: async () =>
          await Promise.resolve(
            createUIMessageStreamResponse({
              stream: createUIMessageStream({
                execute: () => {
                  throw new Error("server failure");
                },
                onError: () =>
                  encodeChatExpectedError({ message, status: 402 }),
              }),
            })
          ),
      }),
    });

    await chat.sendMessage({ text: "Hello" });

    expect(chat.status).toBe("error");
    expect(toastMocks.error).toHaveBeenCalledWith(message);
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  test.each([
    "Unexpected server failure.",
    '{"kind":"quieter.chat.expected-error","version":1,"status":500,"message":"private detail"}',
    '{"kind":"quieter.chat.expected-error","version":1,"status":402,"message":"private detail","extra":true}',
    '{"kind":"quieter.chat.expected-error","version":2,"status":402,"message":"private detail"}',
    '{"kind":"quieter.chat.expected-error","version":1,"status":402,"message":" "}',
    '{"status":402,"message":"private detail"}',
  ])(
    "reports unexpected or malformed stream errors and hides their text (%s)",
    async (errorText) => {
      const chat = new Chat({
        onError: (error) => {
          toastError(decodeChatStreamError(error), {
            fallback: "Retry safely.",
          });
        },
        transport: new DefaultChatTransport({
          fetch: async () =>
            await Promise.resolve(
              createUIMessageStreamResponse({
                stream: createUIMessageStream({
                  execute: () => {
                    throw new Error("server failure");
                  },
                  onError: () => errorText,
                }),
              })
            ),
        }),
      });

      await chat.sendMessage({ text: "Hello" });

      expect(chat.status).toBe("error");
      expect(toastMocks.error).toHaveBeenCalledWith("Retry safely.");
      expect(sentryMocks.captureException).toHaveBeenCalledOnce();
    }
  );
});
