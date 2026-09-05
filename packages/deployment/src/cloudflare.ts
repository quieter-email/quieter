import { z } from "zod";

import { identifierSchema } from "./schema.ts";
import type { RuntimeProvider } from "./schema.ts";

const deploymentSchema = z.object({
  created_on: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  versions: z
    .array(z.object({ percentage: z.number(), version_id: z.uuid() }))
    .min(1),
});

export class CloudflareRuntimeProvider implements RuntimeProvider {
  private readonly base: string;
  private readonly token: string;
  private readonly request: typeof fetch;

  constructor(accountId: string, token: string, request: typeof fetch = fetch) {
    if (!/^[a-f\d]{32}$/u.test(accountId) || !token) {
      throw new Error("Cloudflare deployment credentials are incomplete.");
    }
    this.base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`;
    this.token = token;
    this.request = request;
  }

  async active(scriptName: string) {
    const result = z
      .object({ deployments: z.array(deploymentSchema).min(1) })
      .parse(await this.call(scriptName, "deployments"));
    const deployments = result.deployments.toSorted(
      (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
    );
    const [active] = deployments;
    if (active.versions.length !== 1 || active.versions[0].percentage !== 100) {
      throw new Error(
        "Split deployments require explicit reconciliation before automated release."
      );
    }
    return { id: active.id, versionId: active.versions[0].version_id };
  }

  async verifyVersion(scriptName: string, versionId: string) {
    z.uuid().parse(versionId);
    const version = z
      .object({ id: z.uuid() })
      .parse(await this.call(scriptName, `versions/${versionId}`));
    if (version.id !== versionId) {
      throw new Error("Cloudflare returned an unexpected version.");
    }
  }

  async activate(scriptName: string, versionId: string) {
    z.uuid().parse(versionId);
    await this.call(scriptName, "deployments", {
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
      }),
      method: "POST",
    });
  }

  private async call(
    scriptName: string,
    suffix: string,
    init: RequestInit = {}
  ) {
    identifierSchema.parse(scriptName);
    const response = await this.request(
      `${this.base}/${scriptName}/${suffix}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare release operation failed with HTTP ${response.status}.`
      );
    }
    const envelope = z
      .object({ result: z.unknown(), success: z.literal(true) })
      .safeParse(await response.json());
    if (!envelope.success) {
      throw new Error("Cloudflare returned an invalid release response.");
    }
    return envelope.data.result;
  }
}
