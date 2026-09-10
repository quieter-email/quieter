import type { SyncApi } from "@quieter/sync-client/types";

import { rpc } from "#/lib/orpc";

export const mailSyncApi: SyncApi = {
  body: async (mailboxId, messageId, hash, signal) =>
    await rpc.mail.getSyncBody({ hash, mailboxId, messageId }, { signal }),
  command: async (mailboxId, commandId, signal) =>
    await rpc.mail.getSyncCommand({ commandId, mailboxId }, { signal }),
  connection: async (signal) =>
    await rpc.mail.createSyncConnection(undefined, { signal }),
  hydrate: async (mailboxId, threadIds, signal) =>
    await rpc.mail.hydrateSyncThreads({ mailboxId, threadIds }, { signal }),
  replay: async (mailboxId, checkpoint, signal) =>
    await rpc.mail.getSyncReplay({ checkpoint, mailboxId }, { signal }),
  snapshot: async (mailboxId, signal) =>
    await rpc.mail.getSyncSnapshot({ mailboxId }, { signal }),
  submit: async (command, signal) =>
    await rpc.mail.submitSyncCommand(command, { signal }),
};
