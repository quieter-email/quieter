export const AI_COST_RECOVERY_BASIS_POINTS = 1_500;

export const applyAiCostRecoveryFee = (costMicroCents: number) =>
  Math.ceil(costMicroCents * (1 + AI_COST_RECOVERY_BASIS_POINTS / 10_000));

export const getAiUsageCostMicroCents = (costUsd: number) => {
  if (!Number.isFinite(costUsd) || costUsd <= 0) {
    throw new Error("AI provider cost must be a finite positive number.");
  }

  return applyAiCostRecoveryFee(Math.round(costUsd * 100 * 1_000_000));
};
