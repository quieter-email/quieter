import { syncBatchSchema } from "@quieter/sync";
import type { SyncBatch } from "@quieter/sync";
import { DurableObject } from "cloudflare:workers";

type Subscriber = { userId: string; expiresAt: number };
type Work = { mailboxId: string; generation: number; queued: number };

export class MailboxSync extends DurableObject<SyncEnv> {
  constructor(ctx: DurableObjectState, env: SyncEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS subscribers (userId TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL)"
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS work (id INTEGER PRIMARY KEY CHECK(id = 1), mailboxId TEXT NOT NULL, generation INTEGER NOT NULL, queued INTEGER NOT NULL)"
    );
  }

  subscribe(userId: string) {
    this.ctx.storage.sql.exec(
      "INSERT INTO subscribers VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET expiresAt=excluded.expiresAt",
      userId,
      Date.now() + 180_000
    );
  }

  unsubscribe(userId: string) {
    this.ctx.storage.sql.exec(
      "DELETE FROM subscribers WHERE userId = ?",
      userId
    );
  }

  async publish(input: SyncBatch) {
    const batch = syncBatchSchema.parse(input);
    this.ctx.storage.sql.exec(
      "DELETE FROM subscribers WHERE expiresAt <= ?",
      Date.now()
    );
    const subscribers = this.ctx.storage.sql
      .exec<Subscriber>("SELECT * FROM subscribers")
      .toArray();
    // The database outbox remains pending until every recipient has accepted this batch.
    // Reversed arrivals and duplicate attempts are resolved by each replica's committed cursor.
    for (let offset = 0; offset < subscribers.length; offset += 16) {
      await Promise.all(
        subscribers.slice(offset, offset + 16).map(async ({ userId }) => {
          await this.env.UserSyncObjects.getByName(userId).publish(batch);
        })
      );
    }
  }

  async accessChanged() {
    const subscribers = this.ctx.storage.sql
      .exec<Subscriber>(
        "SELECT * FROM subscribers WHERE expiresAt > ?",
        Date.now()
      )
      .toArray();
    for (let offset = 0; offset < subscribers.length; offset += 16) {
      await Promise.all(
        subscribers.slice(offset, offset + 16).map(async ({ userId }) => {
          await this.env.UserSyncObjects.getByName(userId).accessChanged();
        })
      );
    }
  }

  async wake(mailboxId: string) {
    this.ctx.storage.sql.exec(
      "INSERT INTO work VALUES (1, ?, 1, 0) ON CONFLICT(id) DO UPDATE SET generation=generation+1",
      mailboxId
    );
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
  }

  beginWork() {
    return (
      this.ctx.storage.sql
        .exec<Work>("SELECT mailboxId, generation, queued FROM work WHERE id=1")
        .toArray()[0]?.generation ?? null
    );
  }

  async finishWork(generation: number, hasMore: boolean) {
    const [current] = this.ctx.storage.sql
      .exec<Work>("SELECT mailboxId, generation, queued FROM work WHERE id=1")
      .toArray();
    if (current === undefined) {
      return;
    }
    if (!hasMore && current.generation === generation) {
      this.ctx.storage.sql.exec("DELETE FROM work WHERE id=1");
      await this.ctx.storage.deleteAlarm();
      return;
    }
    this.ctx.storage.sql.exec("UPDATE work SET queued=0 WHERE id=1");
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  async alarm() {
    const [work] = this.ctx.storage.sql
      .exec<Work>("SELECT mailboxId, generation, queued FROM work WHERE id=1")
      .toArray();
    if (work === undefined) {
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    await this.env.MailSyncQueue.send({ mailboxId: work.mailboxId });
    this.ctx.storage.sql.exec("UPDATE work SET queued=1 WHERE id=1");
  }
}
