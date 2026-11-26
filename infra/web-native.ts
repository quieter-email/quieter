import { createHmac } from "node:crypto";

import { z } from "zod";

import { cloudflareWorkerObservability } from "./runtime";
import type { SecretBindings, SecretResource, SstLinkable } from "./types";

const webNativeAppName = "quieter-production-web-app";

const awsPermissionsSchema = z.object({
  include: z.array(
    z.object({
      actions: z.array(z.string()),
      conditions: z
        .array(
          z.object({
            test: z.string(),
            values: z.array(z.string()),
            variable: z.string(),
          })
        )
        .optional(),
      effect: z.enum(["allow", "deny"]).optional(),
      resources: z.array(z.string()),
      type: z.literal("aws.permission"),
    })
  ),
});

const webSecretBindingSchema = z.object({
  include: z.tuple([
    z.object({
      binding: z.literal("secretTextBindings"),
      properties: z.object({ text: z.string() }),
      type: z.literal("cloudflare.binding"),
    }),
  ]),
});

export const createNativeWeb = (input: {
  accountId: string;
  hyperdriveId: $util.Input<string>;
  linkPermissions: SstLinkable[];
  runtimeEnvironment: Record<string, $util.Input<string>>;
  secretBindings: SecretBindings;
  signingSecret: SecretResource;
}) => {
  const worker = new cloudflare.Worker("WebNativeApp", {
    accountId: z
      .string()
      .regex(/^[\da-f]{32}$/u)
      .parse(input.accountId),
    name: webNativeAppName,
    observability: cloudflareWorkerObservability,
    subdomain: { enabled: false, previewsEnabled: false },
  });
  const user = new aws.iam.User("WebNativeAwsUser", {});
  const policy = aws.iam.getPolicyDocumentOutput({
    statements: $util
      .output({ links: input.linkPermissions.map((link) => link.getSSTLink()) })
      .apply(({ links }) =>
        links.flatMap((link) =>
          awsPermissionsSchema.parse(link).include.map((permission) => ({
            actions: permission.actions,
            conditions: permission.conditions,
            effect: permission.effect === "deny" ? "Deny" : "Allow",
            resources: permission.resources,
          }))
        )
      ),
  });
  const webPolicy = new aws.iam.UserPolicy("WebNativeAwsPolicy", {
    policy: policy.json,
    user: user.name,
  });
  const key = new aws.iam.AccessKey(
    "WebNativeAwsCredentials",
    { user: user.name },
    { dependsOn: [webPolicy] }
  );
  const probeToken = $util.secret(
    input.signingSecret.value.apply((secret) => {
      if (secret.length === 0) {
        throw new Error("The web release signing secret is empty.");
      }
      return createHmac("sha256", secret)
        .update("quieter.web.release.probe.v1")
        .digest("hex");
    })
  );
  const secrets = $util.secret(
    $util
      .output({
        bindings: Object.entries(input.secretBindings).map(
          ([name, binding]) => ({
            link: binding.getSSTLink(),
            name,
          })
        ),
      })
      .apply(({ bindings }) => ({
        ...Object.fromEntries(
          bindings.map(({ name, link }) => [
            name,
            webSecretBindingSchema.parse(link).include[0].properties.text,
          ])
        ),
        AWS_ACCESS_KEY_ID: key.id,
        AWS_SECRET_ACCESS_KEY: key.secret,
      }))
  );
  const runtime = new sst.Linkable("WebReleaseRuntime", {
    properties: {
      hyperdriveId: input.hyperdriveId,
      name: worker.name,
      probeToken,
      secrets,
      vars: {
        ...input.runtimeEnvironment,
        SST_RESOURCE_App: JSON.stringify({
          name: $app.name,
          stage: $app.stage,
        }),
      },
    },
  });
  return {
    probeToken: runtime.properties.probeToken,
    scriptName: runtime.properties.name,
    workerId: worker.id,
  };
};
