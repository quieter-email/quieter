import { readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import { checkDeployment } from "./check-deployment.ts";

const recordSchema = z.object({
  account: z.string().regex(/^[a-f0-9]{32}$/u),
  buildId: z.string().regex(/^[\w.-]{1,128}$/u),
  release: z.string().regex(/^[a-f0-9]{40}-\d+$/u),
  script: z.string().regex(/^[\w-]+$/u),
  version: z.uuid(),
});

export const recoverWeb = async (input: {
  mode: string;
  recordFile: string;
  account: string;
  token: string;
  expectedVersion?: string;
  release?: string;
}) => {
  const { mode, recordFile, account, token, expectedVersion, release } = input;
  if (!/^[a-f0-9]{32}$/u.test(account) || token === "") {
    throw new Error("Invalid recovery credentials.");
  }
  const api = async (route: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/${route}`,
      {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: body === undefined ? "GET" : "POST",
        signal: AbortSignal.timeout(20_000),
      }
    );
    const result = z
      .object({ result: z.unknown(), success: z.boolean() })
      .parse(await response.json());
    if (!response.ok || !result.success) {
      throw new Error(`Cloudflare operation failed: HTTP ${response.status}`);
    }
    return result.result;
  };
  const domains = z
    .array(z.object({ hostname: z.string(), service: z.string() }))
    .parse(await api("domains"));
  const script = domains.find(
    (domain) => domain.hostname === "quieter.email"
  )?.service;
  if (script === undefined || script === "" || !/^[\w-]+$/u.test(script)) {
    throw new Error(
      "Cannot identify the Worker currently serving quieter.email."
    );
  }
  const deploymentsSchema = z.object({
    deployments: z.array(
      z.object({
        created_on: z.string(),
        versions: z.array(
          z.object({ percentage: z.number(), version_id: z.uuid() })
        ),
      })
    ),
  });
  const deployments = deploymentsSchema.parse(
    await api(`scripts/${script}/deployments`)
  );
  const [active] = deployments.deployments.toSorted((left, right) =>
    right.created_on.localeCompare(left.created_on)
  );
  if (active?.versions.length !== 1 || active.versions[0]?.percentage !== 100) {
    throw new Error("Recovery requires one active Worker version at 100%.");
  }
  const version = active.versions[0].version_id;
  if (mode === "record") {
    const response = await fetch("https://quieter.email/assets/build-id.txt", {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Cannot read the current release marker: HTTP ${response.status}`
      );
    }
    // The first release installing health checks cannot have a verified recovery record.
    if (
      !response.ok ||
      response.headers.get("content-type")?.includes("text/plain") !== true
    ) {
      process.stdout.write(
        "No previous release marker. Recovery starts after the first verified release.\n"
      );
    } else {
      const markerText = await response.text();
      const buildId = markerText.trim();
      await checkDeployment("https://quieter.email", buildId);
      const latest = deploymentsSchema.parse(
        await api(`scripts/${script}/deployments`)
      );
      const [confirmed] = latest.deployments.toSorted((left, right) =>
        right.created_on.localeCompare(left.created_on)
      );
      if (
        confirmed?.versions.length !== 1 ||
        confirmed.versions[0]?.version_id !== version ||
        confirmed.versions[0]?.percentage !== 100
      ) {
        throw new Error(
          "The active version changed during health verification."
        );
      }
      const record = recordSchema.parse({
        account,
        buildId,
        release,
        script,
        version,
      });
      await writeFile(recordFile, JSON.stringify(record, null, 2), {
        flag: "wx",
      });
      process.stdout.write(`Recorded healthy web version ${version}.\n`);
    }
  } else if (mode === "restore") {
    const record = recordSchema.parse(
      JSON.parse(await readFile(recordFile, "utf-8"))
    );
    if (
      record.account !== account ||
      record.script !== script ||
      version !== expectedVersion
    ) {
      throw new Error(
        "Account, domain or current version changed. Inspect production before retrying recovery."
      );
    }
    await api(`scripts/${script}/deployments`, {
      annotations: {
        "workers/message": `Restore healthy web release ${record.buildId}`,
      },
      strategy: "percentage",
      versions: [{ percentage: 100, version_id: record.version }],
    });
    await checkDeployment("https://quieter.email", record.buildId);
    process.stdout.write(
      `Restored and verified ${record.version}. The next SST release must refresh state.\n`
    );
  } else {
    throw new Error(
      "Usage: web-recovery.ts record|restore <record-file> [expected-current-version]"
    );
  }
};
if (import.meta.main) {
  const [mode, recordFile, expectedVersion] = process.argv.slice(2);
  if (!mode || !recordFile) {
    throw new Error("Supply a mode and recovery record path.");
  }
  await recoverWeb({
    account: process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID ?? "",
    expectedVersion,
    mode,
    recordFile,
    release: `${process.env.GITHUB_SHA ?? ""}-${process.env.GITHUB_RUN_ID ?? ""}`,
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  });
}
