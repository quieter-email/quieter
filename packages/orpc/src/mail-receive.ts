import type { MailAgentIncomingMessage } from "./mail-agent/contracts";
import type { VerificationCodeProcessingResult } from "./verification-codes";

type MessageIdentity = Pick<
  MailAgentIncomingMessage,
  "mailboxId" | "messageId"
>;
type AutoLabelOutcome =
  | { status: "complete" }
  | {
      reason: "admission_busy" | "budget" | "failure";
      retryAt: Date;
      status: "retry";
    }
  | {
      reason: "disabled" | "no_owner" | "not_entitled";
      status: "skipped";
    };

type ReceiveStages = {
  auto_label: {
    identity: MessageIdentity;
    outcome: AutoLabelOutcome;
  };
  managed_rules: {
    identity: MessageIdentity;
    outcome:
      | { matched: boolean; status: "complete" }
      | { status: "needs_attention" };
  };
  personal_action: {
    identity: MessageIdentity & { actorUserId: string; runId: string };
    outcome:
      | {
          status: "complete" | "lost_ownership" | "needs_attention" | "skipped";
        }
      | { reason: "admission_busy"; retryAt: Date; status: "retry" };
  };
  personal_actions: {
    identity: MessageIdentity;
    outcome:
      | { admitted: number; status: "handed_off" }
      | { reason: "not_admitted"; status: "skipped" };
  };
  verification_code: {
    identity: MessageIdentity;
    outcome:
      | VerificationCodeProcessingResult
      | { reason: "no_owner"; status: "skipped" };
  };
};

type ReceiveStageId = keyof ReceiveStages;
export type ReceiveStageOutcome<S extends ReceiveStageId> =
  ReceiveStages[S]["outcome"];
type ReceiveStageAttempt<S extends ReceiveStageId> = {
  elapsedMs: number;
  stage: S;
  status: ReceiveStageOutcome<S>["status"] | "failed" | "not_started";
};

export const runReceiveStage = async <
  S extends ReceiveStageId,
  R extends ReceiveStageOutcome<S>,
>(input: {
  execute: (identity: ReceiveStages[NoInfer<S>]["identity"]) => Promise<R>;
  identity: ReceiveStages[NoInfer<S>]["identity"];
  onAttempt?: (attempt: ReceiveStageAttempt<S>) => undefined;
  signal?: AbortSignal;
  stage: S;
}): Promise<R> => {
  const startedAt = performance.now();
  let status: ReceiveStageAttempt<S>["status"] = "not_started";
  try {
    input.signal?.throwIfAborted();
    status = "failed";
    const result = await input.execute(input.identity);
    ({ status } = result);
    return result;
  } finally {
    try {
      input.onAttempt?.({
        elapsedMs: performance.now() - startedAt,
        stage: input.stage,
        status,
      });
    } catch {
      // Observer failures must not replace the owner's result.
    }
  }
};
