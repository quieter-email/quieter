export const resolveCampaignDeliveryState = (input: {
  attempts: number;
  canceled: boolean;
  eligible: boolean;
  hasSendOperation: boolean;
  interrupted: boolean;
  operationStatus:
    | "accepted"
    | "completed"
    | "pending"
    | "prepared"
    | "rejected"
    | "submitting"
    | "unknown"
    | undefined;
  recipientStatus: "sending" | "uncertain";
}) => {
  if (
    input.operationStatus === "accepted" ||
    input.operationStatus === "completed"
  ) {
    return "sent";
  }
  if (
    input.operationStatus === "pending" ||
    input.operationStatus === "submitting" ||
    input.operationStatus === "unknown" ||
    input.recipientStatus === "uncertain" ||
    (input.interrupted &&
      input.hasSendOperation &&
      input.operationStatus === undefined)
  ) {
    return "uncertain";
  }
  if (input.canceled) {
    return "canceled";
  }
  if (!input.eligible) {
    return "excluded";
  }
  return input.attempts >= 3 ? "failed" : "pending";
};
