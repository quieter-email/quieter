import type { LanguageModelMiddleware } from "ai";
import { z } from "zod";

type StreamResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

const toolInputChunk = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          tool_calls: z
            .array(
              z.object({
                function: z
                  .object({
                    arguments: z.string().nullish(),
                    name: z.string().nullish(),
                  })
                  .nullish(),
                index: z.number().int().nonnegative().nullish(),
              })
            )
            .nullish(),
        })
        .nullish(),
    })
  ),
});

export const createOpenRouterToolInputTransform = ({
  includeRawChunks = false,
}: {
  includeRawChunks?: boolean;
} = {}): TransformStream<StreamPart, StreamPart> => {
  const calls = new Map<
    number,
    { emitted: boolean; input: string; toolName: string }
  >();
  let lastIndex = -1;
  let interrupted = false;

  return new TransformStream({
    flush() {
      if (!interrupted && [...calls.values()].some((call) => !call.emitted)) {
        throw new Error("The assistant returned incomplete tool input.");
      }
    },
    transform(part, controller) {
      if (part.type === "raw") {
        const parsed = toolInputChunk.safeParse(part.rawValue);
        for (const delta of parsed.data?.choices[0]?.delta?.tool_calls ?? []) {
          const index = delta.index ?? lastIndex;
          lastIndex = Math.max(lastIndex, index);
          const call = calls.get(index);
          if (call) {
            call.input += delta.function?.arguments ?? "";
          } else if (delta.function?.name) {
            calls.set(index, {
              emitted: false,
              input: delta.function.arguments ?? "",
              toolName: delta.function.name,
            });
          }
        }
        if (includeRawChunks) {
          controller.enqueue(part);
        }
        return;
      }
      if (part.type === "tool-call") {
        // The adapter replaces malformed arguments with {} and can replace IDs.
        // Match the original input before the SDK can execute a synthesized call.
        const call = [...calls.values()].find(
          (candidate) =>
            !candidate.emitted &&
            candidate.toolName === part.toolName &&
            candidate.input === part.input
        );
        if (!call) {
          throw new Error("The assistant returned incomplete tool input.");
        }
        call.emitted = true;
      }
      if (part.type === "error") {
        interrupted = true;
      }
      if (part.type === "finish") {
        interrupted ||= ["length", "content-filter", "error"].includes(
          part.finishReason.unified
        );
        if (!interrupted && [...calls.values()].some((call) => !call.emitted)) {
          throw new Error("The assistant returned incomplete tool input.");
        }
      }
      controller.enqueue(part);
    },
  });
};
