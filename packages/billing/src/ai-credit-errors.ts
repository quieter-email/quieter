import { ORPCError } from "@orpc/server";

export class AiCreditAdmissionBusyError extends ORPCError<
  "FORBIDDEN",
  undefined
> {
  constructor() {
    super("FORBIDDEN", {
      message:
        "AI features require available usage balance. Try again after the current request finishes.",
    });
    this.name = "AiCreditAdmissionBusyError";
  }
}
