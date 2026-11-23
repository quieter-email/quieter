import { serverEnv } from "@quieter/env/server";
import {
  AiProviderDeferredError,
  GmailBackgroundQuotaDeferredError,
  withAiProviderAdmission,
  withGmailBackgroundQuota,
} from "@quieter/orpc/gmail-work";
import { DurableObject } from "cloudflare:workers";

import type { GmailDispatch } from "./gmail-mailbox-scheduler";
import { reportWorkerError } from "./worker-runtime";

const MAX_QUOTA_SHARDS = 16;
const MAX_REQUEST_UNITS = 3000;
const CREDIT_TTL_MS = 2000;
const LANE_SHARE = { background: 0.4, fresh: 0.55, watch: 0.05 } as const;
type QuotaLane = keyof typeof LANE_SHARE;
type Credit = { units: number; validUntil: number };
type QuotaPool = { available: number; updatedAt: number };
type QuotaDecision =
  | { kind: "granted"; credit: Credit }
  | { kind: "deferred"; retryAt: number };

const gmailShardCount = () =>
  Math.min(
    MAX_QUOTA_SHARDS,
    Math.max(
      1,
      Math.floor(
        (serverEnv.QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE *
          LANE_SHARE.background) /
          (2 * MAX_REQUEST_UNITS)
      )
    )
  );

const modelShardCount = () =>
  Math.min(
    MAX_QUOTA_SHARDS,
    Math.max(
      1,
      Math.floor(
        (serverEnv.QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE ?? 160) / 10
      )
    )
  );

export class GmailProjectQuota extends DurableObject<Env> {
  #acquire(input: {
    bucket: QuotaLane | "model";
    burst: number;
    needed: number;
    requestsPerMinute: number | undefined;
  }): QuotaDecision {
    // oxlint-disable-next-line node/no-sync -- Cloudflare's embedded SQLite transaction has no Node filesystem I/O.
    return this.ctx.storage.transactionSync(() => {
      const { kv } = this.ctx.storage;
      const now = Date.now();
      const blockedUntil = kv.get<number>("blockedUntil") ?? 0;
      if (blockedUntil > now) {
        return { kind: "deferred", retryAt: blockedUntil };
      }

      if (input.requestsPerMinute === undefined) {
        return {
          credit: { units: 32, validUntil: now + CREDIT_TTL_MS },
          kind: "granted",
        };
      }
      const rate =
        (input.requestsPerMinute - input.burst) / (60_000 + CREDIT_TTL_MS);
      const past = kv.get<QuotaPool>(input.bucket);
      const units = Math.min(
        input.burst,
        past === undefined
          ? input.burst
          : past.available + Math.max(0, now - past.updatedAt) * rate
      );
      if (units < input.needed) {
        return {
          kind: "deferred",
          retryAt: now + Math.ceil((input.needed - units) / rate),
        };
      }

      const target = Math.max(
        input.needed,
        Math.min(512, Math.floor(rate * CREDIT_TTL_MS))
      );
      const granted = Math.floor(Math.min(target, units));
      kv.put(input.bucket, { available: units - granted, updatedAt: now });
      return {
        credit: { units: granted, validUntil: now + CREDIT_TTL_MS },
        kind: "granted",
      };
    });
  }

  acquire(lane: QuotaLane, needed: number): QuotaDecision {
    return this.#acquire({
      bucket: lane,
      burst: lane === "watch" ? 100 : MAX_REQUEST_UNITS,
      needed,
      requestsPerMinute:
        (serverEnv.QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE *
          LANE_SHARE[lane]) /
        gmailShardCount(),
    });
  }

  acquireModel(): QuotaDecision {
    const configured =
      serverEnv.QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE;
    const partition =
      configured === undefined ? undefined : configured / modelShardCount();
    return this.#acquire({
      bucket: "model",
      burst: Math.max(2, Math.floor((partition ?? 0) / 30)),
      needed: 1,
      requestsPerMinute: partition,
    });
  }

  pause(until: number) {
    // oxlint-disable-next-line node/no-sync -- Cloudflare's embedded SQLite transaction has no Node filesystem I/O.
    this.ctx.storage.transactionSync(() => {
      const { kv } = this.ctx.storage;
      if (until > (kv.get<number>("blockedUntil") ?? 0)) {
        kv.put("blockedUntil", until);
      }
    });
  }
}

const workerCredits = new Map<string, Credit>();
const observedPause = new Map<"gmail" | "model", number>();

const consumeQuota = async (input: {
  bucket: string;
  needed: number;
  acquire: () => Promise<QuotaDecision>;
}): Promise<number | null> => {
  const balance = workerCredits.get(input.bucket);
  if (
    balance !== undefined &&
    balance.validUntil > Date.now() &&
    balance.units >= input.needed
  ) {
    balance.units -= input.needed;
    return null;
  }
  const result = await input.acquire();
  if (result.kind === "deferred") {
    return result.retryAt;
  }

  const now = Date.now();
  const granted = result.credit;
  if (granted.validUntil <= now) {
    return now;
  }
  const current = workerCredits.get(input.bucket);
  if (current !== undefined && current.validUntil > now) {
    granted.units += current.units;
    granted.validUntil = Math.min(granted.validUntil, current.validUntil);
  }
  granted.units -= input.needed;
  workerCredits.set(input.bucket, granted);
  return null;
};

export const withProjectGmailQuota = async <T>(
  env: Pick<Env, "GmailProjectQuota">,
  dispatch: Pick<GmailDispatch, "mailboxId" | "task">,
  execute: () => Promise<T>
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(dispatch.mailboxId)
    )
  );
  const hash = digest[0] ?? 0;
  const namespace =
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
      ? env.GmailProjectQuota
      : env.GmailProjectQuota.jurisdiction("eu");
  const quotaStub = (kind: "gmail" | "model", index: number) =>
    namespace.getByName(`${kind}-v1-${index}`, { locationHint: "weur" });

  const pause = async (kind: "gmail" | "model", delayMs: number) => {
    const now = Date.now();
    if ((observedPause.get(kind) ?? 0) > now) {
      return;
    }
    const until = now + delayMs;
    observedPause.set(kind, until);
    for (const key of workerCredits.keys()) {
      if (key.startsWith(`${kind}:`)) {
        workerCredits.delete(key);
      }
    }
    const results = await Promise.allSettled(
      Array.from({ length: MAX_QUOTA_SHARDS }, async (_, index) => {
        await quotaStub(kind, index).pause(until);
      })
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed !== undefined) {
      reportWorkerError(failed.reason, {
        category: "gmail_provider_quota_pause_failed",
        route: "queue",
      });
    }
  };

  return await withGmailBackgroundQuota(
    {
      observeProjectLimit: async (retryAfterMs) => {
        await pause("gmail", Math.max(60_000, retryAfterMs));
      },
      reserve: async (needed, purpose) => {
        const now = Date.now();
        const pausedUntil = observedPause.get("gmail") ?? 0;
        if (pausedUntil > now) {
          throw new GmailBackgroundQuotaDeferredError(pausedUntil);
        }
        const preferred =
          dispatch.task === "discover" || dispatch.task === "fresh"
            ? "fresh"
            : "background";
        const lane = purpose === "watch" ? "watch" : preferred;
        const choices: readonly QuotaLane[] =
          lane === "background" ? [lane] : [lane, "background"];
        const shard = hash % gmailShardCount();
        let earliest = Infinity;
        for (const choice of choices) {
          const retryAt = await consumeQuota({
            acquire: async () =>
              await quotaStub("gmail", shard).acquire(choice, needed),
            bucket: `gmail:${shard}:${choice}`,
            needed,
          });
          if (retryAt === null) {
            return;
          }
          earliest = Math.min(earliest, retryAt);
        }
        throw new GmailBackgroundQuotaDeferredError(
          Math.max(now + 250, earliest) + Math.floor(Math.random() * 1000)
        );
      },
    },
    async () =>
      await withAiProviderAdmission(
        {
          observeRateLimit: async (retryAfterMs) => {
            await pause("model", Math.max(10_000, retryAfterMs));
          },
          reserve: async () => {
            if (dispatch.task !== "catchup") {
              return;
            }
            const pausedUntil = observedPause.get("model") ?? 0;
            if (pausedUntil > Date.now()) {
              throw new AiProviderDeferredError(pausedUntil);
            }
            const shard = hash % modelShardCount();
            const retryAt = await consumeQuota({
              acquire: async () =>
                await quotaStub("model", shard).acquireModel(),
              bucket: `model:${shard}`,
              needed: 1,
            });
            if (retryAt !== null) {
              throw new AiProviderDeferredError(
                retryAt + 250 + Math.floor(Math.random() * 1000)
              );
            }
          },
        },
        execute
      )
  );
};
