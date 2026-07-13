export const AI_COST_RECOVERY_BASIS_POINTS = 1_500;

export const applyAiCostRecoveryFee = (costMicroCents: number) =>
  Math.ceil(costMicroCents * (1 + AI_COST_RECOVERY_BASIS_POINTS / 10_000));

export const convertProviderCostToCreditMicroCents = (input: {
  costUsd: number;
  usdToEurRate: number;
}) => {
  if (!Number.isFinite(input.costUsd) || input.costUsd <= 0) {
    throw new Error("AI provider cost must be a finite positive number.");
  }
  if (!Number.isFinite(input.usdToEurRate) || input.usdToEurRate <= 0) {
    throw new Error("The USD to EUR billing rate must be a finite positive number.");
  }

  return applyAiCostRecoveryFee(Math.round(input.costUsd * input.usdToEurRate * 100 * 1_000_000));
};
