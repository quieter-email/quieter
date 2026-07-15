import type { MessagePart } from "@tanstack/ai";
import { cn } from "@quieter/ui/cn";
import type { ResolveComposeTool } from "../../types";
import { hasVisibleAssistantContent } from "../../domain/assistant-content";
import { shouldUngroupTool } from "../../domain/tool-summaries";
import { ThinkingIndicator } from "../thinking-indicator";
import { TextPart } from "./text-part";
import { ThinkingPart } from "./thinking-part";
import { ToolPart } from "./tool-part";
import { ToolActivityGroup } from "./tools/tool-activity-group";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

type RenderSegment =
  | { index: number; part: Extract<MessagePart, { type: "text" }>; type: "text" }
  | { index: number; part: Extract<MessagePart, { type: "thinking" }>; type: "thinking" }
  | {
      items: Array<{ call: ToolCall; result?: ToolResult }>;
      type: "tools";
    }
  | { result: ToolResult; type: "orphan-result" };

const getLastThinkingIndex = (parts: MessagePart[]) =>
  parts.reduce<number>((last, part, index) => (part.type === "thinking" ? index : last), -1);

const getLastTextIndex = (parts: MessagePart[]) =>
  parts.reduce<number>(
    (last, part, index) =>
      part.type === "text" && typeof part.content === "string" && part.content.trim()
        ? index
        : last,
    -1,
  );

const getPartKey = (part: MessagePart, index: number) => {
  if (part.type === "text" || part.type === "thinking") {
    const partId = "id" in part && typeof part.id === "string" ? part.id : index;
    return `${part.type}:${partId}`;
  }

  if (part.type === "tool-call") return `tool-call:${part.id}`;
  if (part.type === "tool-result") return `tool-result:${part.toolCallId}`;
  return part.type;
};

const buildSegments = (
  parts: MessagePart[],
  toolCalls: Map<string, ToolCall>,
  toolResults: Map<string, ToolResult>,
): RenderSegment[] => {
  const segments: RenderSegment[] = [];
  let toolBuffer: Array<{ call: ToolCall; result?: ToolResult }> = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) {
      return;
    }

    segments.push({ items: toolBuffer, type: "tools" });
    toolBuffer = [];
  };

  for (const [index, part] of parts.entries()) {
    if (part.type === "tool-call") {
      if (shouldUngroupTool(part)) {
        flushTools();
        segments.push({
          items: [{ call: part, result: toolResults.get(part.id) }],
          type: "tools",
        });
        continue;
      }

      toolBuffer.push({ call: part, result: toolResults.get(part.id) });
      continue;
    }

    if (part.type === "tool-result") {
      if (toolCalls.has(part.toolCallId)) {
        continue;
      }

      flushTools();
      segments.push({ result: part, type: "orphan-result" });
      continue;
    }

    flushTools();

    if (part.type === "text") {
      segments.push({ index, part, type: "text" });
      continue;
    }

    if (part.type === "thinking") {
      segments.push({ index, part, type: "thinking" });
    }
  }

  flushTools();
  return segments;
};

export const AssistantParts = ({
  actionsDisabled,
  assistantMessageId,
  isStreaming = false,
  onResolveCompose,
  parts,
}: {
  actionsDisabled?: boolean;
  assistantMessageId: string;
  isStreaming?: boolean;
  onResolveCompose: ResolveComposeTool;
  parts: MessagePart[];
}) => {
  const lastThinkingIndex = getLastThinkingIndex(parts);
  const lastTextIndex = isStreaming ? getLastTextIndex(parts) : -1;
  const toolCalls = new Map(
    parts.flatMap((part) => (part.type === "tool-call" ? [[part.id, part] as const] : [])),
  );
  const toolResults = new Map(
    parts.flatMap((part) =>
      part.type === "tool-result" ? [[part.toolCallId, part] as const] : [],
    ),
  );
  const segments = buildSegments(parts, toolCalls, toolResults);

  const hasVisible = hasVisibleAssistantContent(parts);
  const showThinking = !hasVisible && isStreaming;

  return (
    <div className={cn("flex min-h-5 flex-col gap-1.5", { "min-h-6": showThinking })}>
      {showThinking ? <ThinkingIndicator /> : null}
      {segments.map((segment) => {
        if (segment.type === "text") {
          if (!segment.part.content.trim()) {
            return null;
          }

          return (
            <TextPart
              isStreaming={isStreaming && segment.index === lastTextIndex}
              key={getPartKey(segment.part, segment.index)}
              text={segment.part.content}
            />
          );
        }

        if (segment.type === "thinking") {
          const isActive = isStreaming && segment.index === lastThinkingIndex;
          if (!segment.part.content.trim() && !isActive) {
            return null;
          }

          return (
            <ThinkingPart
              content={segment.part.content}
              isActive={isActive}
              key={getPartKey(segment.part, segment.index)}
            />
          );
        }

        if (segment.type === "orphan-result") {
          return (
            <ToolPart
              actionsDisabled={actionsDisabled}
              assistantMessageId={assistantMessageId}
              key={segment.result.toolCallId}
              onResolveCompose={onResolveCompose}
              result={segment.result}
            />
          );
        }

        if (segment.items.length === 1 && shouldUngroupTool(segment.items[0]!.call)) {
          const item = segment.items[0]!;
          return (
            <ToolPart
              actionsDisabled={actionsDisabled}
              assistantMessageId={assistantMessageId}
              call={item.call}
              isStreaming={isStreaming}
              key={item.call.id}
              onResolveCompose={onResolveCompose}
              result={item.result}
            />
          );
        }

        return (
          <ToolActivityGroup
            actionsDisabled={actionsDisabled}
            assistantMessageId={assistantMessageId}
            isStreaming={isStreaming}
            items={segment.items}
            key={segment.items.map((item) => item.call.id).join(":")}
            onResolveCompose={onResolveCompose}
          />
        );
      })}
    </div>
  );
};
