export const canonicalMailJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalMailJson).join(",")}]`;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : Number(left > right)))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${canonicalMailJson(entry)}`
      )
      .join(",")}}`;
  }
  throw new Error("Mail ledger content must contain only JSON values.");
};
