import { createSstConfigEnv } from "@quieter/env/sst";

import { production, stage } from "./stage";

export const createMailEventRelay = (
  dispatchUrl: $util.Input<string>,
  signingKey: $util.Output<string>
) => {
  const env = createSstConfigEnv({ production });
  const replicationSecret = new sst.Secret("MailEventReplicationUrl");

  // ECS's SST link stores JSON in the task definition's plaintext environment.
  // SecureString bindings let the ECS execution role inject only the two secrets at startup.
  const replication = new aws.ssm.Parameter(
    "MailEventRelayReplicationBinding",
    {
      name: `/${$app.name}/${stage}/mail-event-relay/replication-url`,
      type: "SecureString",
      value: replicationSecret.value,
    }
  );
  const signing = new aws.ssm.Parameter("MailEventRelaySigningBinding", {
    name: `/${$app.name}/${stage}/mail-event-relay/signing-key`,
    type: "SecureString",
    value: signingKey,
  });

  const vpc = new sst.aws.Vpc("MailEventRelayVpc");
  const cluster = new sst.aws.Cluster("MailEventRelayCluster", { vpc });
  return new sst.aws.Service("MailEventRelay", {
    cluster,
    cpu: "0.25 vCPU",
    dev: false,
    environment: {
      MAIL_DISPATCH_URL: dispatchUrl,
      MAIL_EVENT_REPLICATION_SLOT: `quieter_mail_dispatch_${stage.toLowerCase().replaceAll("-", "_")}`,
      QUIETER_MAIL_EVENT_RELAY_SHARDED: String(
        env.QUIETER_MAIL_EVENT_RELAY_SHARDED ?? true
      ),
    },
    image: { context: "packages/mail-event-relay" },
    memory: "0.5 GB",
    scaling: {
      cpuUtilization: false,
      max: 1,
      memoryUtilization: false,
      min: 1,
    },
    ssm: {
      GMAIL_LIVE_SYNC_TOKEN_SECRET: signing.arn,
      MAIL_EVENT_REPLICATION_URL: replication.arn,
    },
    transform: {
      executionRole(args) {
        args.inlinePolicies = [
          {
            name: "mail-event-relay-bindings",
            policy: $util.jsonStringify({
              Statement: [
                {
                  Action: "ssm:GetParameters",
                  Effect: "Allow",
                  Resource: [replication.arn, signing.arn],
                },
              ],
              Version: "2012-10-17",
            }),
          },
        ];
      },
      service(args) {
        args.deploymentMaximumPercent = 100;
        args.deploymentMinimumHealthyPercent = 0;
        args.enableExecuteCommand = false;
      },
    },
  });
};
