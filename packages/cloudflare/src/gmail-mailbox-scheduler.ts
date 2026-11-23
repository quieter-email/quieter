import { serverEnv } from "@quieter/env/server";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { GMAIL_EXECUTOR_SHARDS } from "./gmail-processing-config";
import { reportWorkerError } from "./worker-runtime";

const tasks = ["discover", "fresh", "sync", "catchup"] as const;
export type GmailMailboxTask = (typeof tasks)[number];

export const gmailDispatchSchema = z.object({
  mailboxId: z.string().min(1),
  task: z.enum(tasks),
  token: z.uuid(),
});
export type GmailDispatch = z.infer<typeof gmailDispatchSchema>;

type Lease = {
  token: string;
  expiresAt: number;
  state: "sent" | "running";
};
type Lane = {
  dueAt: number | null;
  lease: Lease | null;
  blockedUntil?: number;
};

const DELIVERY_LEASE_MS = 15 * 60_000;
// The consumer may run for 15 minutes. A DB claim started near its end can
// remain live after this lease, so its expiry still controls message retries.
const EXECUTION_LEASE_MS = 16 * 60_000;

const laneDeadline = (lane: Lane) =>
  lane.lease?.expiresAt ??
  Math.max(lane.dueAt ?? Infinity, lane.blockedUntil ?? 0);

export const gmailMailboxScheduler = (
  env: Pick<Env, "GmailMailboxScheduler">,
  mailboxId: string
) => {
  const namespace =
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
      ? env.GmailMailboxScheduler
      : env.GmailMailboxScheduler.jurisdiction("eu");
  return namespace.getByName(mailboxId, { locationHint: "weur" });
};

export class GmailMailboxScheduler extends DurableObject<Env> {
  async #update<T>(
    change: (
      lanes: Map<GmailMailboxTask, Lane>,
      storage: DurableObjectTransaction
    ) => T | Promise<T>
  ): Promise<T> {
    return await this.ctx.storage.transaction(async (storage) => {
      const lanes = new Map(
        await storage.get<[GmailMailboxTask, Lane][]>("lanes")
      );
      const result = await change(lanes, storage);
      const next = Math.min(...[...lanes.values()].map(laneDeadline));
      await storage.put("lanes", [...lanes]);
      if (Number.isFinite(next)) {
        const alarm = await storage.getAlarm();
        if (alarm === null || next < alarm) {
          await storage.setAlarm(Math.max(next, Date.now() + 1));
        }
      } else {
        await storage.deleteAlarm();
      }
      return result;
    });
  }

  async wake(
    mailboxId: string,
    wakes: Partial<Record<GmailMailboxTask, number>>,
    observedHistoryId?: string
  ) {
    await this.#update(async (lanes, storage) => {
      if (lanes.size === 0) {
        await storage.put("mailboxId", mailboxId);
      }
      if (observedHistoryId !== undefined) {
        const previous = await storage.get<string>("observedHistoryId");
        if (
          previous !== undefined &&
          BigInt(observedHistoryId) <= BigInt(previous)
        ) {
          return;
        }
        await storage.put("observedHistoryId", observedHistoryId);
      }
      for (const task of tasks) {
        const dueAt = wakes[task];
        if (dueAt === undefined) {
          continue;
        }
        const lane = lanes.get(task) ?? { dueAt: null, lease: null };
        lane.dueAt = Math.min(lane.dueAt ?? Infinity, dueAt);
        lanes.set(task, lane);
      }
    });
  }

  async start({ task, token }: GmailDispatch) {
    return await this.#update((lanes) => {
      const lane = lanes.get(task);
      if (lane?.lease?.token !== token || lane.lease.state !== "sent") {
        return false;
      }
      lane.lease = {
        expiresAt: Date.now() + EXECUTION_LEASE_MS,
        state: "running",
        token,
      };
      return true;
    });
  }

  async finish(
    { task, token }: GmailDispatch,
    outcome: {
      nextAt: number | null;
      retryAt?: number;
      wakes?: Partial<Record<GmailMailboxTask, number>>;
    }
  ) {
    return await this.#update((lanes) => {
      const lane = lanes.get(task);
      if (
        lane?.lease?.token !== token ||
        lane.lease.state !== "running" ||
        lane.lease.expiresAt <= Date.now()
      ) {
        return false;
      }
      lane.lease = null;
      lane.blockedUntil = outcome.retryAt;
      const nextAt = Math.min(
        lane.dueAt ?? Infinity,
        outcome.nextAt ?? Infinity
      );
      lane.dueAt = Number.isFinite(nextAt) ? nextAt : null;
      for (const otherTask of tasks) {
        const dueAt = outcome.wakes?.[otherTask];
        if (dueAt !== undefined) {
          const otherLane = lanes.get(otherTask) ?? {
            dueAt: null,
            lease: null,
          };
          otherLane.dueAt = Math.min(otherLane.dueAt ?? Infinity, dueAt);
          lanes.set(otherTask, otherLane);
        }
      }
      return true;
    });
  }

  async alarm() {
    const mailboxId = await this.ctx.storage.get<string>("mailboxId");
    if (mailboxId === undefined) {
      throw new Error("Gmail mailbox scheduler requires a named object.");
    }
    const dispatches = await this.#update((lanes) => {
      const now = Date.now();
      const ready: GmailDispatch[] = [];
      for (const task of tasks) {
        const lane = lanes.get(task);
        if (lane === undefined) {
          continue;
        }
        const next = laneDeadline(lane);
        if (next <= now) {
          const token =
            lane.lease?.state === "sent"
              ? lane.lease.token
              : crypto.randomUUID();
          if (lane.lease === null) {
            lane.dueAt = null;
          }
          lane.lease = {
            expiresAt: now + DELIVERY_LEASE_MS,
            state: "sent",
            token,
          };
          ready.push({ mailboxId, task, token });
        }
      }
      return ready;
    });
    if (dispatches.length === 0) {
      return;
    }
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mailboxId))
    );
    const shard =
      GMAIL_EXECUTOR_SHARDS[(hash[0] ?? 0) % GMAIL_EXECUTOR_SHARDS.length] ?? 0;
    await Promise.all(
      dispatches.map(async (dispatch) => {
        const lane =
          dispatch.task === "fresh" || dispatch.task === "discover"
            ? "Fresh"
            : "Catchup";
        try {
          await this.env[`GmailMailbox${lane}Queue${shard}`].send(dispatch);
        } catch (error) {
          reportWorkerError(error, {
            category: "gmail_mailbox_dispatch_failed",
            route: "alarm",
          });
          await this.#update((lanes) => {
            const lease = lanes.get(dispatch.task)?.lease;
            if (lease?.token === dispatch.token && lease.state === "sent") {
              lease.expiresAt = Date.now() + 60_000;
            }
          });
        }
      })
    );
  }
}
