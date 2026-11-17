import { controlErrorSchema } from "@quieter/orpc/control/contracts";
import {
  CONTROL_REVIEW_HEADER,
  CONTROL_REVIEW_INTENT,
  controlMutationReviewSchema,
} from "@quieter/orpc/control/mutation-contracts";
import {
  CONTROL_API_PATH,
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "@quieter/orpc/control/openapi";

export class ControlReviewRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ControlReviewRequestError";
    this.status = status;
  }
}

export const requestControlReview = async (input: {
  action: "review" | "approve" | "cancel";
  id: string;
  signal?: AbortSignal;
}) => {
  const headers = new Headers({
    "content-type": "application/json",
    [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
  });
  const path =
    input.action === "approve"
      ? "reviews/approve"
      : `mutations/${input.action}`;
  if (input.action === "approve") {
    headers.set(CONTROL_REVIEW_HEADER, CONTROL_REVIEW_INTENT);
  }
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${CONTROL_API_PATH}/${path}`, {
      body: JSON.stringify({ id: input.id }),
      cache: "no-store",
      credentials: "same-origin",
      headers,
      method: "POST",
      redirect: "error",
      signal: input.signal,
    });
    body = await response.json();
  } catch {
    throw new Error("The change could not be loaded. Please try again.");
  }
  if (!response.ok) {
    const failure = controlErrorSchema.safeParse(body);
    if (response.status >= 400 && response.status < 500 && failure.success) {
      throw new ControlReviewRequestError(
        failure.data.error.message,
        response.status
      );
    }
    throw new Error("The change could not be loaded. Please try again.");
  }
  const review = controlMutationReviewSchema.safeParse(body);
  if (!review.success || review.data.id !== input.id) {
    throw new Error("The change could not be loaded. Please try again.");
  }
  return review.data;
};
