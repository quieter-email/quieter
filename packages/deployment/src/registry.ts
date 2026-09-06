export type RuntimeRegistration = {
  service: string;
  package: string;
  entrypoint: string;
  trigger:
    | "http"
    | "http-durable-object"
    | "http-scheduled"
    | "queue"
    | "scheduled"
    | "queue-scheduled"
    | "sns"
    | "sqs";
  nativeReleaseBlockers: string[];
};

// These are existing runtime boundaries. New mail services join only when their handlers exist.
export const runtimeRegistry: RuntimeRegistration[] = [
  {
    entrypoint: "packages/cloudflare/src/mail-feedback-worker.ts",
    nativeReleaseBlockers: [
      "mail_runtime_foundation",
      "protected_health_bindings",
      "independent_recovery_workflow",
    ],
    package: "@quieter/cloudflare",
    service: "mail-feedback-intake",
    trigger: "http-scheduled",
  },
  {
    entrypoint: "packages/aws/src/mail-feedback-bridge.ts",
    nativeReleaseBlockers: [
      "published_lambda_alias",
      "alias_trigger_proof",
      "feedback_queue_ownership",
    ],
    package: "@quieter/aws",
    service: "mail-feedback-bridge",
    trigger: "sqs",
  },
  {
    entrypoint: "packages/cloudflare/src/mail-submission-sender-worker.ts",
    nativeReleaseBlockers: [
      "mail_runtime_foundation",
      "protected_health_bindings",
      "independent_recovery_workflow",
    ],
    package: "@quieter/cloudflare",
    service: "mail-sender",
    trigger: "queue-scheduled",
  },
  {
    entrypoint: "packages/cloudflare/src/mail-api-worker.ts",
    nativeReleaseBlockers: [
      "mail_runtime_foundation",
      "protected_health_bindings",
      "independent_recovery_workflow",
    ],
    package: "@quieter/cloudflare",
    service: "mail-api",
    trigger: "http",
  },
  {
    entrypoint: "packages/cloudflare/src/mail-submission-publisher-worker.ts",
    nativeReleaseBlockers: [
      "mail_runtime_foundation",
      "protected_health_bindings",
      "independent_recovery_workflow",
    ],
    package: "@quieter/cloudflare",
    service: "mail-outbox-publisher",
    trigger: "queue-scheduled",
  },
  {
    entrypoint: "apps/web/src/server.ts",
    nativeReleaseBlockers: [
      "production_ownership_transfer",
      "protected_recovery_proof",
    ],
    package: "@quieter/web",
    service: "web",
    trigger: "http",
  },
  {
    entrypoint: "packages/cloudflare/src/worker.ts",
    nativeReleaseBlockers: [
      "durable_object_version_proof",
      "production_ownership_transfer",
    ],
    package: "@quieter/cloudflare",
    service: "gmail-realtime",
    trigger: "http-durable-object",
  },
  {
    entrypoint: "packages/cloudflare/src/queue-worker.ts",
    nativeReleaseBlockers: [
      "queue_version_proof",
      "production_ownership_transfer",
    ],
    package: "@quieter/cloudflare",
    service: "gmail-sync",
    trigger: "queue",
  },
  {
    entrypoint: "packages/cloudflare/src/gmail-maintenance-worker.ts",
    nativeReleaseBlockers: [
      "scheduled_version_proof",
      "production_ownership_transfer",
    ],
    package: "@quieter/cloudflare",
    service: "gmail-maintenance",
    trigger: "scheduled",
  },
  {
    entrypoint: "packages/cloudflare/src/mailbox-action-worker.ts",
    nativeReleaseBlockers: [
      "queue_version_proof",
      "production_ownership_transfer",
    ],
    package: "@quieter/cloudflare",
    service: "mailbox-actions",
    trigger: "queue",
  },
  {
    entrypoint: "packages/cloudflare/src/mailbox-action-dispatch-worker.ts",
    nativeReleaseBlockers: [
      "scheduled_version_proof",
      "production_ownership_transfer",
    ],
    package: "@quieter/cloudflare",
    service: "mailbox-action-dispatch",
    trigger: "scheduled",
  },
  {
    entrypoint: "packages/aws/src/receipt.ts",
    nativeReleaseBlockers: ["published_lambda_alias", "alias_trigger_proof"],
    package: "@quieter/aws",
    service: "mail-receipt",
    trigger: "sns",
  },
  {
    entrypoint: "packages/aws/src/outbound-feedback.ts",
    nativeReleaseBlockers: ["published_lambda_alias", "alias_trigger_proof"],
    package: "@quieter/aws",
    service: "mail-feedback",
    trigger: "sns",
  },
  {
    entrypoint: "packages/aws/src/inbound.ts",
    nativeReleaseBlockers: ["published_lambda_alias", "alias_trigger_proof"],
    package: "@quieter/aws",
    service: "mail-ingress",
    trigger: "http",
  },
];
