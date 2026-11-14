export const operationsRanges = [7, 30, 90, "all"] as const;

export type OperationsRange = (typeof operationsRanges)[number];
