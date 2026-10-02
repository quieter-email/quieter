import { createHash } from "node:crypto";

export const hashRequest = (message: object) => {
  const serialized = JSON.stringify(message, (_key, value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).toSorted(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : value
  );
  return createHash("sha256").update(serialized).digest("hex");
};
