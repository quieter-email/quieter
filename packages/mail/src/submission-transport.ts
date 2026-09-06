export type SubmissionTransportResult =
  | { outcome: "accepted"; providerMessageId: string }
  | { outcome: "rejected"; code: string; retryable: boolean }
  | { outcome: "unknown"; code: string };

export type PreparedSubmission = {
  attemptId: string;
  bcc: string[];
  cc: string[];
  deadline: Date;
  from: string;
  raw: string;
  replyTo: string[];
  submissionId: string;
  tags: { name: string; value: string }[];
  to: string[];
};
