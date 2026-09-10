export const recordSyncMetric = (
  operation: "queue" | "maintenance" | "health",
  values: Record<string, number>
) => {
  if (
    Object.values(values).some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return;
  }
  // oxlint-disable-next-line no-console -- Structured operational metrics contain only bounded categories and numbers.
  console.info("mail_sync_metric", { operation, ...values });
};
