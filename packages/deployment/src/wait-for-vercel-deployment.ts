const requiredEnvironmentVariable = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const deployHookUrl = requiredEnvironmentVariable("VERCEL_DEPLOY_HOOK_URL");
const projectId = requiredEnvironmentVariable("VERCEL_PROJECT_ID");
const teamId = requiredEnvironmentVariable("VERCEL_TEAM_ID");
const token = requiredEnvironmentVariable("VERCEL_TOKEN");
const triggeredAt = Date.now();
const headers = { Authorization: `Bearer ${token}` };

const hookResponse = await fetch(deployHookUrl, { method: "POST" });
if (!hookResponse.ok) {
  throw new Error(
    `Vercel deploy hook failed with ${hookResponse.status}: ${await hookResponse.text()}`,
  );
}

const deadline = triggeredAt + 15 * 60 * 1000;
let deploymentId: string | undefined;

while (Date.now() < deadline) {
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("target", "production");
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
      uid: string;
      url: string;
    }>;
  };
  const deployment = result.deployments?.find(
    (candidate) =>
      candidate.created >= triggeredAt - 5_000 && (!deploymentId || candidate.uid === deploymentId),
  );

  if (deployment) {
    deploymentId = deployment.uid;
    const state = deployment.readyState ?? deployment.state;

    if (state === "READY") {
      console.log(`Vercel production deployment is ready: https://${deployment.url}`);
      process.exit(0);
    }

    if (state === "ERROR" || state === "CANCELED") {
      throw new Error(`Vercel production deployment ${deployment.uid} ended in ${state}`);
    }

    console.log(`Vercel production deployment ${deployment.uid} is ${state ?? "pending"}.`);
  } else {
    console.log("Waiting for the Vercel production deployment to appear.");
  }

  await Bun.sleep(10_000);
}

throw new Error("Timed out waiting for the Vercel production deployment");

export {};
