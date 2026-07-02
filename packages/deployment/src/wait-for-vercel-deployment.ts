import { createDeploymentEnv } from "@quieter/env/deployment";
import { spawnSync } from "node:child_process";

const {
  VERCEL_DEPLOY_HOOK_URL: deployHookUrl,
  VERCEL_DEPLOYMENT_GIT_REF: gitRef,
  VERCEL_DEPLOYMENT_TARGET: target,
  VERCEL_PROJECT_ID: projectId,
  VERCEL_TEAM_ID: teamId,
  VERCEL_TOKEN: token,
} = createDeploymentEnv();
const triggeredAt = Date.now();
const headers = { Authorization: `Bearer ${token}` };

const triggerDeployHook = () => {
  const result = spawnSync(
    process.platform === "win32" ? "curl.exe" : "curl",
    [
      "--fail-with-body",
      "--silent",
      "--show-error",
      "--max-time",
      "60",
      "--retry",
      "2",
      "--retry-delay",
      "3",
      "-X",
      "POST",
      deployHookUrl,
    ],
    {
      encoding: "utf8",
    },
  );

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("curl is required to trigger the Vercel deploy hook from CI.");
    }

    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Vercel deploy hook failed with exit code ${result.status ?? 1}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  console.log("Vercel deploy hook accepted the staging request.");
};

triggerDeployHook();

const deadline = triggeredAt + 15 * 60 * 1000;
let deploymentId: string | undefined;

while (Date.now() < deadline) {
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  if (target === "production") {
    url.searchParams.set("target", target);
  }
  url.searchParams.set("limit", "10");

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `Failed to list Vercel deployments with ${response.status}: ${await response.text()}`,
    );
  }

  const result = (await response.json()) as {
    deployments?: Array<{
      created: number;
      readyState?: string;
      state?: string;
      meta?: {
        deployHookRef?: string;
        githubCommitRef?: string;
      };
      uid: string;
      url: string;
    }>;
  };
  const deployment = result.deployments?.find(
    (candidate) =>
      candidate.created >= triggeredAt - 5_000 &&
      (!deploymentId || candidate.uid === deploymentId) &&
      (!gitRef ||
        candidate.meta?.deployHookRef === gitRef ||
        candidate.meta?.githubCommitRef === gitRef),
  );

  if (deployment) {
    deploymentId = deployment.uid;
    const state = deployment.readyState ?? deployment.state;

    if (state === "READY") {
      console.log(`Vercel ${target} deployment is ready: https://${deployment.url}`);
      process.exit(0);
    }

    if (state === "ERROR" || state === "CANCELED") {
      throw new Error(`Vercel ${target} deployment ${deployment.uid} ended in ${state}`);
    }

    console.log(`Vercel ${target} deployment ${deployment.uid} is ${state ?? "pending"}.`);
  } else {
    console.log(`Waiting for the Vercel ${target} deployment to appear.`);
  }

  await Bun.sleep(10_000);
}

throw new Error(`Timed out waiting for the Vercel ${target} deployment`);

export {};
