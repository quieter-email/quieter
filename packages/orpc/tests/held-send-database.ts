import { execFile, execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// oxlint-disable-next-line typescript/strict-void-return -- Node promisify accepts execFile even though it also returns a ChildProcess.
const execute = promisify(execFile);

export const canRunHeldSendDatabase = () => {
  if (process.env.CI === "true") {
    return true;
  }
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

export const createHeldSendDatabase = async () => {
  const container = `quieter-held-send-${crypto.randomUUID()}`;
  let client: ReturnType<typeof postgres> | undefined;
  const dispose = async () => {
    try {
      await client?.end({ timeout: 1 });
    } finally {
      await execute("docker", ["rm", "--force", container]);
    }
  };
  await execute("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env",
    "POSTGRES_DB=held_send_test",
    "postgres:17-alpine",
  ]);
  try {
    const { stdout } = await execute("docker", ["port", container, "5432/tcp"]);
    const port = /^127\.0\.0\.1:(?<port>\d+)\s*$/u.exec(stdout)?.groups?.port;
    if (port === undefined) {
      throw new Error("The test database must bind a loopback port.");
    }
    client = postgres({
      database: "held_send_test",
      host: "127.0.0.1",
      max: 2,
      port: Number(port),
      username: "postgres",
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await execute("docker", [
        "exec",
        container,
        "pg_isready",
        "--host=127.0.0.1",
        "--username=postgres",
        "--dbname=held_send_test",
      ]).catch(() => null);
      if (result !== null) {
        ready = true;
        break;
      }
      await setTimeout(50);
    }
    if (!ready) {
      throw new Error("The disposable test database did not start.");
    }
    await client.unsafe(`
      CREATE TABLE "user" (id text PRIMARY KEY);
      CREATE TABLE mailbox (id text PRIMARY KEY);
      CREATE TABLE "scheduledMailSend" (
        "createdAt" timestamptz NOT NULL,
        "deliveryKind" text NOT NULL DEFAULT 'scheduled',
        "draftRemovedAt" timestamptz,
        "errorMessage" text,
        id text PRIMARY KEY,
        "leaseToken" text,
        "leaseUntil" timestamptz,
        "mailboxId" text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
        "nextWakeAt" timestamptz,
        "payloadRetiredAt" timestamptz,
        "rawObjectBucket" text NOT NULL,
        "rawObjectKey" text NOT NULL,
        "rawObjectProvider" text NOT NULL,
        "requestHash" text NOT NULL,
        "restoredDraftId" text,
        "sendAt" timestamptz NOT NULL,
        "sendOperationId" text NOT NULL,
        "sentAt" timestamptz,
        "sentMessageId" text,
        "sourceDraftId" text,
        "sourceLocalId" text NOT NULL,
        status text NOT NULL,
        subject text NOT NULL,
        "timeZone" text NOT NULL,
        "to" text NOT NULL,
        "updatedAt" timestamptz NOT NULL,
        "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        CONSTRAINT scheduled_mail_send_operation_unique
          UNIQUE ("mailboxId", "userId", "sendOperationId"),
        CONSTRAINT scheduled_mail_send_status_check CHECK
          (status IN ('preparing', 'scheduled', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
        CONSTRAINT scheduled_mail_send_delivery_kind_check CHECK
          ("deliveryKind" IN ('scheduled', 'undo'))
      );
      CREATE UNIQUE INDEX scheduled_mail_send_source_local_unique
        ON "scheduledMailSend" ("mailboxId", "sourceLocalId")
        WHERE status IN ('preparing', 'scheduled', 'sending', 'failed', 'uncertain');
      CREATE UNIQUE INDEX scheduled_mail_send_source_draft_unique
        ON "scheduledMailSend" ("mailboxId", "sourceDraftId")
        WHERE status IN ('preparing', 'scheduled', 'sending', 'failed', 'uncertain');
      CREATE TABLE "scheduledMailSendAbandonment" (
        "createdAt" timestamptz NOT NULL,
        "mailboxId" text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
        "sendOperationId" text NOT NULL,
        "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY ("mailboxId", "userId", "sendOperationId")
      );
      CREATE TABLE "gmailComposeOperation" (
        "createdAt" timestamp NOT NULL,
        "draftId" text,
        "followUpReminder" jsonb,
        id text PRIMARY KEY,
        kind text NOT NULL,
        "mailboxId" text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
        "messageHeaderId" text NOT NULL,
        "operationKey" text NOT NULL,
        "requestHash" text NOT NULL,
        response jsonb,
        status text NOT NULL,
        "updatedAt" timestamp NOT NULL,
        CONSTRAINT gmail_compose_operation_mailbox_key_unique
          UNIQUE ("mailboxId", "operationKey")
      );
      CREATE UNIQUE INDEX gmail_compose_operation_active_draft_send_unique
        ON "gmailComposeOperation" ("mailboxId", "draftId")
        WHERE kind = 'send' AND status IN ('submitting', 'unknown', 'accepted');
      CREATE TABLE "managedMailMessage" (
        id text PRIMARY KEY,
        "mailboxId" text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
        "providerMessageId" text,
        "mailboxState" text
      );
      INSERT INTO "user" VALUES ('owner'), ('other-user');
      INSERT INTO mailbox VALUES ('mailbox'), ('other-mailbox');
    `);
    return { client, database: drizzle({ client }), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
};
