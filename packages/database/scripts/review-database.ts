export const REVIEW_APP_ROLE = "quieter_review_app";

export const parseReviewPullRequestNumber = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    throw new Error("REVIEW_PR_NUMBER must be a positive integer");
  }

  const pullRequestNumber = Number(trimmed);
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("REVIEW_PR_NUMBER must be a positive integer");
  }

  return pullRequestNumber;
};
