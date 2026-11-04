import { ORPCError } from "@orpc/server";

export const getPersonalActionCutoverError = (error: unknown) => {
  const seen = new Set<Error>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      "code" in current &&
      current.code === "55000" &&
      "constraint_name" in current &&
      current.constraint_name === "quieter_action_cutover"
    ) {
      return new ORPCError("CONFLICT", {
        cause: error,
        message: current.message,
      });
    }
    const { cause } = current;
    current = cause;
  }
  return null;
};
