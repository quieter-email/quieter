import { z } from "zod";

import type { RuntimeEnvironment } from "./schema";

export const createReleaseOperationsEnv = (
  purpose: "runtime" | "recovery" | "source-maps",
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      AWS_REGION: z
        .string()
        .regex(/^[a-z]{2}-[a-z]+-\d$/u)
        .default("eu-central-1"),
      QUIETER_RELEASE_BINDINGS_PARAMETER: z
        .string()
        .regex(
          /^arn:aws:ssm:[a-z\d-]+:\d{12}:parameter\/[\w-]+\/[\w-]+\/release\/(?:runtime|recovery|source-maps)$/u
        ),
      QUIETER_RELEASE_STAGE: z.string().regex(/^[\w-]{1,128}$/u),
    })
    .safeParse(runtime);
  if (
    !result.success ||
    !result.data.QUIETER_RELEASE_BINDINGS_PARAMETER.startsWith(
      `arn:aws:ssm:${result.data.AWS_REGION}:`
    ) ||
    !result.data.QUIETER_RELEASE_BINDINGS_PARAMETER.endsWith(
      `/${result.data.QUIETER_RELEASE_STAGE}/release/${purpose}`
    )
  ) {
    throw new Error(
      "Release operations require the intended stage, region, and binding parameter."
    );
  }
  return result.data;
};

export const createReleaseOperationsChildEnv = (
  value: string,
  stage: string,
  purpose: "runtime" | "recovery" | "source-maps",
  runtime: RuntimeEnvironment = process.env
) => {
  const app = z.strictObject({ stage: z.literal(stage) });
  const secret = z.strictObject({ value: z.string().min(1) });
  const schema = z.discriminatedUnion("purpose", [
    z.strictObject({
      purpose: z.enum(["runtime", "recovery"]),
      resources: z.strictObject({
        App: app,
        ReleaseCloudflareToken: secret,
        ReleaseProofToken: z.strictObject({ value: z.string().min(32) }),
      }),
      schemaVersion: z.literal(1),
    }),
    z.strictObject({
      purpose: z.literal("source-maps"),
      resources: z.strictObject({ App: app, ReleaseSourceMapToken: secret }),
      schemaVersion: z.literal(1),
    }),
  ]);
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("Invalid release operation bindings.");
  }
  const result = schema.safeParse(input);
  if (!result.success || result.data.purpose !== purpose) {
    throw new Error(
      "Release operation bindings do not match their purpose and stage."
    );
  }
  return {
    ...Object.fromEntries(
      Object.entries(runtime).filter(
        ([key]) =>
          !key.toUpperCase().startsWith("SST_RESOURCE") &&
          !["CLOUDFLARE_API_TOKEN", "QUIETER_RELEASE_PROBE_TOKEN"].includes(
            key.toUpperCase()
          )
      )
    ),
    SST_RESOURCES_JSON: JSON.stringify(result.data.resources),
  };
};

export const createTrustedBuildEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      GITHUB_OUTPUT: z.string().optional(),
      GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
      GITHUB_TOKEN: z.string().min(1),
    })
    .safeParse(runtime);
  if (!result.success) {
    throw new Error(
      "Trusted build verification requires a repository and GitHub read credential."
    );
  }
  return result.data;
};

export const createSourceMapDestinationEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      organization: z.string().regex(/^[\w-]{1,128}$/u),
      project: z.string().regex(/^[\w-]{1,128}$/u),
      stage: z.string().regex(/^[\w-]{1,128}$/u),
      url: z.enum([
        "https://sentry.io",
        "https://de.sentry.io",
        "https://us.sentry.io",
      ]),
    })
    .safeParse({
      organization: runtime.SENTRY_ORG,
      project: runtime.SENTRY_PROJECT,
      stage: runtime.QUIETER_RELEASE_STAGE,
      url: runtime.SENTRY_URL,
    });
  if (!result.success) {
    throw new Error(
      "Source-map verification requires an explicit destination and stage."
    );
  }
  return result.data;
};

export const createReleaseStorageEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      AWS_REGION: z.string().default("eu-central-1"),
      QUIETER_RELEASE_BUCKET: z
        .string()
        .regex(/^[a-z\d][a-z\d.-]{1,61}[a-z\d]$/u),
      QUIETER_RELEASE_STAGE: z.string().regex(/^[\w-]{1,128}$/u),
    })
    .safeParse(runtime);
  if (!result.success) {
    throw new Error("Release storage requires an explicit bucket and stage.");
  }
  return result.data;
};

export const createSourceMapUploadEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  let resources: unknown;
  try {
    const app: unknown = JSON.parse(runtime.SST_RESOURCE_App ?? "null");
    const secret: unknown = JSON.parse(
      runtime.SST_RESOURCE_ReleaseSourceMapToken ?? "null"
    );
    resources =
      runtime.SST_RESOURCES_JSON === undefined
        ? {
            App: app,
            ReleaseSourceMapToken: secret,
          }
        : JSON.parse(runtime.SST_RESOURCES_JSON);
  } catch {
    throw new Error("Invalid linked source-map upload resources.");
  }
  const links = z
    .object({
      App: z.object({ stage: z.string() }),
      ReleaseSourceMapToken: z.object({ value: z.string().min(1) }),
    })
    .safeParse(resources);
  if (
    !links.success ||
    links.data.App.stage !== runtime.QUIETER_RELEASE_STAGE
  ) {
    throw new Error(
      "Source-map upload bindings do not match the intended stage."
    );
  }
  return {
    ...createSourceMapDestinationEnv(runtime),
    token: links.data.ReleaseSourceMapToken.value,
  };
};

export const createDeploymentEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  let probeToken = runtime.QUIETER_RELEASE_PROBE_TOKEN;
  let cloudflareToken = runtime.CLOUDFLARE_API_TOKEN;
  if (runtime.SST_RESOURCES_JSON !== undefined) {
    const links = z
      .object({
        App: z.object({ stage: z.string() }),
        ReleaseCloudflareToken: z
          .object({ value: z.string().min(1) })
          .optional(),
        ReleaseProofToken: z.object({ value: z.string().min(32) }).optional(),
      })
      .safeParse(JSON.parse(runtime.SST_RESOURCES_JSON));
    if (
      !links.success ||
      links.data.App.stage !== runtime.QUIETER_RELEASE_STAGE
    ) {
      throw new Error(
        "Linked release resources do not match the intended stage."
      );
    }
    probeToken = links.data.ReleaseProofToken?.value ?? probeToken;
    cloudflareToken =
      links.data.ReleaseCloudflareToken?.value ?? cloudflareToken;
  }
  if (runtime.SST_RESOURCE_ReleaseProofToken !== undefined) {
    const linked = z
      .object({ value: z.string().min(32) })
      .safeParse(JSON.parse(runtime.SST_RESOURCE_ReleaseProofToken));
    if (!linked.success) {
      throw new Error("Invalid linked release proof token.");
    }
    probeToken = linked.data.value;
  }
  const result = z
    .object({
      AWS_REGION: z.string().default("eu-central-1"),
      CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f\d]{32}$/u),
      CLOUDFLARE_API_TOKEN: z.string().min(1),
      CLOUDFLARE_ARCHIVE_PARENT_KEY_ID: z
        .string()
        .regex(/^[a-f\d]{32}$/u)
        .optional(),
      GITHUB_REPOSITORY: z
        .string()
        .regex(/^[\w.-]+\/[\w.-]+$/u)
        .optional(),
      GITHUB_TOKEN: z.string().min(1).optional(),
      QUIETER_RELEASE_BUCKET: z
        .string()
        .regex(/^[a-z\d][a-z\d.-]{1,61}[a-z\d]$/u),
      QUIETER_RELEASE_PROBE_TOKEN: z.string().min(32).optional(),
      QUIETER_RELEASE_STAGE: z.string().regex(/^[\w-]{1,128}$/u),
    })
    .safeParse({
      ...runtime,
      CLOUDFLARE_API_TOKEN: cloudflareToken,
      QUIETER_RELEASE_PROBE_TOKEN: probeToken,
    });
  if (!result.success) {
    throw new Error(
      `Invalid release configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  }
  return result.data;
};

export const createReleaseProofEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      QUIETER_RELEASE_OPERATION_BINDINGS: z
        .enum(["true", "false"])
        .default("false"),
      QUIETER_RELEASE_PROOF_PHASE: z
        .enum(["baseline", "adopt", "candidate"])
        .default("baseline"),
      QUIETER_RELEASE_SOURCE_MAP_UPLOAD: z
        .enum(["true", "false"])
        .default("false"),
      QUIETER_RELEASE_TRIGGER_SCHEDULE: z
        .enum(["true", "false"])
        .default("false"),
      QUIETER_RELEASE_WEB_PROOF: z.enum(["true", "false"]).default("false"),
    })
    .safeParse(runtime);
  if (!result.success) {
    throw new Error("Invalid release proof phase.");
  }
  return result.data;
};

export const parseReleaseProbeBindings = (bindings: unknown) => {
  const result = z
    .object({
      ASSETS: z
        .custom<{ fetch: (request: Request) => Promise<Response> }>(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            "fetch" in value &&
            typeof value.fetch === "function"
        )
        .optional(),
      PROBE_GENERATION: z.enum(["baseline", "candidate"]),
      PROBE_TOKEN: z.string().min(32),
      PROBE_VERSION: z.object({ id: z.uuid() }),
    })
    .safeParse(bindings);
  if (!result.success) {
    throw new Error("Release probe bindings are incomplete.");
  }
  return result.data;
};

export const parseReleaseTriggerProbeBindings = (bindings: unknown) => {
  const base = parseReleaseProbeBindings(bindings);
  const result = z
    .object({
      PROBE_QUEUE: z.custom<{ send: (body: { id: string }) => Promise<void> }>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "send" in value &&
          typeof value.send === "function"
      ),
      PROBE_RECORDS: z.custom<{
        get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
        put: (key: string, value: string) => Promise<unknown>;
      }>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "get" in value &&
          typeof value.get === "function" &&
          "put" in value &&
          typeof value.put === "function"
      ),
    })
    .safeParse(bindings);
  if (!result.success) {
    throw new Error("Release trigger probe bindings are incomplete.");
  }
  return { ...base, ...result.data };
};

export const parseReleaseDurableProbeBindings = (bindings: unknown) => {
  const base = parseReleaseProbeBindings(bindings);
  const result = z
    .object({
      ReleaseCounter: z.custom<{
        getByName: (name: string) => {
          fetch: (request: Request) => Promise<Response>;
        };
      }>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "getByName" in value &&
          typeof value.getByName === "function"
      ),
    })
    .safeParse(bindings);
  if (!result.success) {
    throw new Error("Release Durable Object probe bindings are incomplete.");
  }
  return { ...base, ...result.data };
};
