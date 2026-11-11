import type { ChatMessagePart } from "@quieter/database/schema";
import type { StepResult, ToolSet } from "ai";

import { hashRequest } from "../request-hash";

type ChatStep = Pick<StepResult<ToolSet>, "toolCalls" | "toolResults">;
type ToolObservation = { input: unknown; output: unknown; toolName: string };

export const createChatStepProgress = (
  mutatingTools: ReadonlySet<string>,
  previousParts: readonly ChatMessagePart[] = []
) => {
  const reads = new Set<string>();
  const writes = new Set<string>();
  let repeatedRounds = 0;

  const recordRound = (calls: readonly ToolObservation[]) => {
    if (calls.length === 0) {
      return;
    }
    let madeProgress = false;
    let changedState = false;
    for (const { input, output, toolName } of calls) {
      if (toolName === "suggest_replies") {
        continue;
      }
      if (mutatingTools.has(toolName)) {
        const confirmed =
          output !== undefined &&
          !(
            typeof output === "object" &&
            output !== null &&
            "status" in output &&
            output.status === "error"
          );
        const key = hashRequest({ confirmed, input, toolName });
        if (!writes.has(key)) {
          writes.add(key);
          madeProgress = true;
          changedState ||= confirmed;
        }
      } else {
        let result = output;
        if (
          typeof output === "object" &&
          output !== null &&
          "fetchedAt" in output
        ) {
          const { fetchedAt: _fetchedAt, ...data } = output;
          result = data;
        }
        const key = hashRequest({ input, result, toolName });
        if (!reads.has(key)) {
          reads.add(key);
          madeProgress = true;
        }
      }
    }
    if (changedState) {
      reads.clear();
    }
    repeatedRounds = madeProgress ? 0 : repeatedRounds + 1;
  };

  let round: ToolObservation[] = [];
  for (const part of previousParts) {
    if (part.type === "step-start") {
      recordRound(round);
      round = [];
    } else if (
      part.type.startsWith("tool-") &&
      (part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "output-denied")
    ) {
      round.push({
        input: part.input,
        output: part.state === "output-available" ? part.output : undefined,
        toolName: part.type.slice("tool-".length),
      });
    }
  }
  recordRound(round);

  return {
    recordStep: ({ toolCalls, toolResults }: ChatStep) => {
      const resultsById = new Map<string, unknown>(
        toolResults.map((result) => [result.toolCallId, result.output])
      );
      recordRound(
        toolCalls.map(({ input, toolCallId, toolName }): ToolObservation => ({
          input,
          output: resultsById.get(toolCallId),
          toolName,
        }))
      );
    },
    get shouldWrapUp() {
      return repeatedRounds >= 2;
    },
  };
};
