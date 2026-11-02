import { ORPCError } from "@orpc/server";

export const AI_CREDIT_ADMISSION_BUSY_MESSAGE =
  "AI features require available usage balance. Try again after the current request finishes.";

export class AiCreditAdmissionBusyError extends ORPCError<
  "FORBIDDEN",
  undefined
> {
  constructor() {
    super("FORBIDDEN", {
      message: AI_CREDIT_ADMISSION_BUSY_MESSAGE,
    });
    this.name = "AiCreditAdmissionBusyError";
  }
}
