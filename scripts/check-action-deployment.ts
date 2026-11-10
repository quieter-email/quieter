import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import {
  actionReleaseEnvironmentSchema,
  createDeploymentVerificationEnv,
  DEPLOYMENT_STATUS_PATH,
  deploymentStatusSchema,
  PERSONAL_ACTION_PROTOCOL,
} from "@quieter/env/deployment";
import { z } from "zod";

import { WEB_RELEASE_SLOTS } from "../infra/web-release-scope.ts";

const targetsSchema = z.object({
  actionDeploymentTargets: z.object({
    lambdas: z.object({
      mailInbound: z.string().min(1),
      mailReceipt: z.string().min(1),
    }),
    workers: z.object({
      gmailMaintenance: z.string().regex(/^[\w-]+$/u),
      gmailProcessing: z.string().regex(/^[\w-]+$/u),
      gmailRealtime: z.string().regex(/^[\w-]+$/u),
      mailMaintenance: z.string().regex(/^[\w-]+$/u),
    }),
  }),
  stage: z.literal("production"),
});

export const checkActionDeployment = async (input: {
  account: string;
  buildId: string;
  sourceCommit: string;
  token: string;
  outputsFile: string;
  evidenceFile: string;
}) => {
  const { actionDeploymentTargets: targets } = targetsSchema.parse(
    JSON.parse(await readFile(input.outputsFile, "utf-8"))
  );
  const api = async (route: string): Promise<unknown> => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/${route}`,
      {
        headers: { authorization: `Bearer ${input.token}` },
        signal: AbortSignal.timeout(20_000),
      }
    );
    const result = z
      .object({ result: z.unknown(), success: z.boolean() })
      .parse(await response.json());
    if (!response.ok || !result.success) {
      throw new Error(
        `Cannot verify deployed Action consumer: HTTP ${response.status}`
      );
    }
    return result.result;
  };
  const activeVersion = async (script: string) => {
    const { deployments } = z
      .object({
        deployments: z.array(
          z.object({
            created_on: z.iso.datetime({ offset: true }),
            versions: z.array(
              z.object({ percentage: z.number(), version_id: z.uuid() })
            ),
          })
        ),
      })
      .parse(await api(`scripts/${script}/deployments`));
    const [active] = deployments.toSorted((a, b) =>
      b.created_on.localeCompare(a.created_on)
    );
    if (
      active?.versions.length !== 1 ||
      active.versions[0]?.percentage !== 100
    ) {
      throw new Error(
        `Action consumer ${script} must have one active version at 100%.`
      );
    }
    return {
      deployedAt: active.created_on,
      version: active.versions[0].version_id,
    };
  };
  const response = await fetch(
    `https://quieter.email${DEPLOYMENT_STATUS_PATH}`,
    {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok) {
    throw new Error("Cannot verify published Action release routing.");
  }
  const manifest = deploymentStatusSchema.parse(await response.json());
  if (
    manifest.current.buildId !== input.buildId ||
    manifest.current.protocol !== PERSONAL_ACTION_PROTOCOL ||
    (manifest.previous !== null &&
      manifest.previous.protocol !== PERSONAL_ACTION_PROTOCOL)
  ) {
    throw new Error(
      "The web router still exposes an incompatible Action release."
    );
  }
  const workerTargets = [
    ...Object.entries(targets.workers).map(([role, script]) => ({
      buildId: input.buildId,
      private: role === "gmailProcessing",
      role,
      script,
    })),
    ...WEB_RELEASE_SLOTS.map(({ serviceName, slot }) => ({
      buildId:
        manifest.previous?.slot === slot
          ? manifest.previous.buildId
          : input.buildId,
      private: true,
      role: `web-${slot}`,
      script: serviceName,
    })),
  ];
  const workers = await Promise.all(
    workerTargets.map(async (target) => {
      const { deployedAt, version } = await activeVersion(target.script);
      const deployed = z
        .object({
          id: z.uuid(),
          resources: z.object({
            bindings: z.array(
              z.object({
                name: z.string(),
                service: z.string().optional(),
                text: z.string().optional(),
                type: z.string(),
              })
            ),
          }),
        })
        .parse(await api(`scripts/${target.script}/versions/${version}`));
      const stamp = actionReleaseEnvironmentSchema.parse(
        Object.fromEntries(
          deployed.resources.bindings
            .filter((binding) => binding.type === "plain_text")
            .map((binding) => [binding.name, binding.text])
        )
      );
      if (
        deployed.id !== version ||
        stamp.QUIETER_BUILD_ID !== target.buildId
      ) {
        throw new Error(
          `Action consumer ${target.role} has not deployed the expected build.`
        );
      }
      if (
        target.role === "gmailRealtime" &&
        !deployed.resources.bindings.some(
          (binding) =>
            binding.name === "GmailProcessingWorker" &&
            binding.type === "service" &&
            binding.service === targets.workers.gmailProcessing
        )
      ) {
        throw new Error(
          "The Gmail queue consumer has no verified processor binding."
        );
      }
      if (target.role === "gmailProcessing") {
        const scripts = z
          .array(
            z.object({ id: z.string(), placement: z.unknown().optional() })
          )
          .parse(await api("scripts"));
        z.object({
          placement: z.object({
            mode: z.literal("targeted"),
            target: z.tuple([
              z.object({ region: z.literal("aws:eu-central-1") }),
            ]),
          }),
        }).parse(scripts.find((script) => script.id === target.script));
      }
      if (target.private) {
        const subdomain = z
          .object({
            enabled: z.boolean(),
            previews_enabled: z.boolean(),
          })
          .parse(await api(`scripts/${target.script}/subdomain`));
        if (subdomain.enabled || subdomain.previews_enabled) {
          throw new Error(
            `Private Worker ${target.role} exposes a workers.dev URL.`
          );
        }
      }
      const current = await activeVersion(target.script);
      if (current.version !== version || current.deployedAt !== deployedAt) {
        throw new Error(
          `Action consumer ${target.role} changed during verification.`
        );
      }
      return {
        buildId: stamp.QUIETER_BUILD_ID,
        deployedAt,
        role: target.role,
        script: target.script,
        version,
      };
    })
  );
  const lambdas = await Promise.all(
    Object.entries(targets.lambdas).map(async ([role, arn]) => {
      // oxlint-disable-next-line promise/avoid-new -- Node execFile exposes a callback API.
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          "aws",
          [
            "lambda",
            "get-function-configuration",
            "--function-name",
            arn,
            "--query",
            "{buildId:Environment.Variables.QUIETER_BUILD_ID,protocol:Environment.Variables.QUIETER_ACTION_PROTOCOL,state:State,update:LastUpdateStatus,revision:RevisionId,code:CodeSha256}",
            "--output",
            "json",
            "--no-cli-pager",
          ],
          { timeout: 30_000 },
          (error, output) => {
            if (error) {
              reject(
                new Error(`Cannot verify deployed Action consumer ${role}.`, {
                  cause: error,
                })
              );
            } else {
              resolve(output);
            }
          }
        );
      });
      const deployed = z
        .object({
          buildId: z.literal(input.buildId),
          code: z.string().min(1),
          protocol: z.literal(PERSONAL_ACTION_PROTOCOL),
          revision: z.string().min(1),
          state: z.literal("Active"),
          update: z.literal("Successful"),
        })
        .parse(JSON.parse(stdout));
      return { ...deployed, arn, role };
    })
  );
  const evidence = {
    buildId: input.buildId,
    lambdas,
    protocol: PERSONAL_ACTION_PROTOCOL,
    sourceCommit: input.sourceCommit,
    verifiedAt: new Date().toISOString(),
    workers,
  };
  await writeFile(input.evidenceFile, JSON.stringify(evidence, null, 2), {
    flag: "wx",
  });
  process.stdout.write(
    `Verified all Action producers, executor, and private web slots for ${input.buildId}.\n`
  );
  return evidence;
};

export const disablePrivateReleaseUrls = async (input: {
  account: string;
  outputsFile: string;
  token: string;
}) => {
  const { actionDeploymentTargets: targets } = targetsSchema.parse(
    JSON.parse(await readFile(input.outputsFile, "utf-8"))
  );
  await Promise.all(
    [
      ...WEB_RELEASE_SLOTS.map(({ serviceName }) => serviceName),
      targets.workers.gmailProcessing,
    ].map(async (serviceName) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/scripts/${serviceName}/subdomain`,
        {
          body: JSON.stringify({ enabled: false, previews_enabled: false }),
          headers: {
            authorization: `Bearer ${input.token}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(20_000),
        }
      );
      const result = z
        .object({ success: z.boolean() })
        .parse(await response.json());
      if (!response.ok || !result.success) {
        throw new Error(
          `Cannot disable direct access to private Worker ${serviceName}.`
        );
      }
    })
  );
};

if (import.meta.main) {
  const env = createDeploymentVerificationEnv();
  const [mode, outputsFile, evidenceFile] = process.argv.slice(2);
  if (mode === "secure-private-releases") {
    await disablePrivateReleaseUrls({
      account: env.CLOUDFLARE_DEFAULT_ACCOUNT_ID,
      outputsFile: outputsFile ?? ".sst/outputs.json",
      token: env.CLOUDFLARE_API_TOKEN,
    });
  } else if (mode === "verify") {
    await checkActionDeployment({
      account: env.CLOUDFLARE_DEFAULT_ACCOUNT_ID,
      buildId: env.QUIETER_BUILD_ID,
      evidenceFile: evidenceFile ?? "action-deployment-evidence.json",
      outputsFile: outputsFile ?? ".sst/outputs.json",
      sourceCommit: env.GITHUB_SHA,
      token: env.CLOUDFLARE_API_TOKEN,
    });
  } else {
    throw new Error(
      "Usage: check-action-deployment.ts secure-private-releases|verify [outputs-file] [evidence-file]"
    );
  }
}
