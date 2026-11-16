import assert from "node:assert/strict";
import { createHash } from "node:crypto";

type ConnectionScope = {
  ownerUserId: string;
  mailboxId: string;
  credentialGeneration: number;
};
type FixtureMessage = {
  id: string;
  parentFolderId: string;
  isRead: boolean;
  changeKey: string;
};
type FolderState = {
  cursor: string;
  messages: Map<string, FixtureMessage>;
};
type Connection = ConnectionScope & { folders: Map<string, FolderState> } & (
    | { kind: "connected" }
    | { kind: "needs_reconnect" }
  );
type OAuthAttempt = ConnectionScope & {
  purpose: "outlook-mail" | "microsoft-calendar";
};
type GraphPage = {
  value: unknown[];
} & (
  | { "@odata.nextLink": string; "@odata.deltaLink"?: never }
  | { "@odata.deltaLink": string; "@odata.nextLink"?: never }
);
type DeltaChange =
  | { kind: "removed"; id: string }
  | { kind: "message"; message: FixtureMessage };

const acceptFixtureConsent = (input: {
  attempts: Map<string, OAuthAttempt>;
  callbackUserId: string;
  state: string;
  grantedScopes: string[];
  tokenResult: "accepted" | "invalid_grant" | "consent_denied";
}): Connection => {
  const digest = createHash("sha256").update(input.state).digest("hex");
  const attempt = input.attempts.get(digest);
  assert.ok(attempt, "The callback must match a pending OAuth attempt.");
  assert.equal(attempt.ownerUserId, input.callbackUserId);
  assert.equal(attempt.purpose, "outlook-mail");
  input.attempts.delete(digest);
  return {
    ownerUserId: attempt.ownerUserId,
    mailboxId: attempt.mailboxId,
    credentialGeneration: attempt.credentialGeneration,
    folders: new Map(),
    kind:
      input.tokenResult === "accepted" &&
      ["User.Read", "Mail.Read"].every((scope) =>
        input.grantedScopes.includes(scope)
      )
        ? "connected"
        : "needs_reconnect",
  };
};

const applyFixturePage = (input: {
  connection: Connection;
  capturedScope: ConnectionScope;
  folderId: string;
  page: GraphPage;
}) => {
  const { connection, capturedScope, folderId, page } = input;
  assert.equal(connection.kind, "connected");
  assert.equal(connection.ownerUserId, capturedScope.ownerUserId);
  assert.equal(connection.mailboxId, capturedScope.mailboxId);
  assert.equal(
    connection.credentialGeneration,
    capturedScope.credentialGeneration
  );
  const cursor = page["@odata.nextLink"] ?? page["@odata.deltaLink"];
  assert.ok(typeof cursor === "string");
  assert.ok(
    Boolean(page["@odata.nextLink"]) !== Boolean(page["@odata.deltaLink"])
  );
  const url = new URL(cursor);
  assert.equal(url.origin, "https://graph.microsoft.com");
  const folderPath =
    /^\/v1\.0\/me\/mailfolders\/([^/]+)\/messages\/delta$/iu.exec(
      url.pathname
    ) ??
    /^\/v1\.0\/me\/mailfolders\('([^']+)'\)\/messages\/delta$/iu.exec(
      url.pathname
    );
  assert.ok(folderPath?.[1]);
  assert.equal(decodeURIComponent(folderPath[1]), folderId);
  assert.ok(!url.username && !url.password && !url.hash);
  const changes: DeltaChange[] = page.value.map((value) => {
    assert.ok(
      typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string" &&
        value.id.length > 0
    );
    if ("@removed" in value) {
      assert.ok(
        typeof value["@removed"] === "object" &&
          value["@removed"] !== null &&
          "reason" in value["@removed"] &&
          value["@removed"].reason === "deleted"
      );
      return { id: value.id, kind: "removed" };
    }
    assert.ok(
      "parentFolderId" in value &&
        value.parentFolderId === folderId &&
        "isRead" in value &&
        typeof value.isRead === "boolean" &&
        "changeKey" in value &&
        typeof value.changeKey === "string"
    );
    return {
      kind: "message",
      message: {
        id: value.id,
        parentFolderId: value.parentFolderId,
        isRead: value.isRead,
        changeKey: value.changeKey,
      },
    };
  });
  const messages = new Map(connection.folders.get(folderId)?.messages);
  for (const change of changes) {
    if (change.kind === "removed") {
      messages.delete(change.id);
    } else {
      messages.set(change.message.id, change.message);
    }
  }
  connection.folders.set(folderId, { cursor, messages });
};

const attempt: OAuthAttempt = {
  ownerUserId: "fixture-owner-a",
  mailboxId: "fixture-mailbox-a",
  credentialGeneration: 1,
  purpose: "outlook-mail",
};
const state = "synthetic-single-use-state";
const digest = createHash("sha256").update(state).digest("hex");
const attempts = new Map([[digest, attempt]]);
const consent = {
  attempts,
  callbackUserId: attempt.ownerUserId,
  state,
  grantedScopes: ["User.Read", "Mail.Read"],
  tokenResult: "accepted",
} satisfies Parameters<typeof acceptFixtureConsent>[0];
assert.throws(() => acceptFixtureConsent({ ...consent, state: "unknown" }));
assert.throws(() =>
  acceptFixtureConsent({ ...consent, callbackUserId: "fixture-owner-b" })
);
attempts.set(digest, { ...attempt, purpose: "microsoft-calendar" });
assert.throws(() => acceptFixtureConsent(consent));
attempts.set(digest, attempt);
const connection = acceptFixtureConsent(consent);
assert.throws(() => acceptFixtureConsent(consent));
process.stdout.write("PASS synthetic callback ownership, purpose and replay\n");

const capturedScope: ConnectionScope = { ...attempt };
const folderId = "inbox";
const initialPage: GraphPage = {
  "@odata.nextLink":
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque%2Bnext%3D",
  value: [
    { id: "same-id", parentFolderId: folderId, isRead: false, changeKey: "z" },
  ],
};
const pageInput = { connection, capturedScope, folderId, page: initialPage };
applyFixturePage(pageInput);
const checkpoint = connection.folders.get(folderId);
assert.equal(checkpoint?.cursor, initialPage["@odata.nextLink"]);
assert.throws(() =>
  applyFixturePage({
    ...pageInput,
    capturedScope: { ...capturedScope, mailboxId: "other" },
  })
);
for (const link of [
  "https://example.invalid/v1.0/me/mailFolders/inbox/messages/delta",
  "https://graph.microsoft.com/v1.0/users/other/messages/delta",
  "https://graph.microsoft.com/v1.0/me/mailFolders/archive/messages/delta",
  "https://graph.microsoft.com/v1.0/me/mailfolders('INBOX')/messages/delta",
  "https://graph.microsoft.com:444/v1.0/me/mailFolders/inbox/messages/delta",
]) {
  assert.throws(() =>
    applyFixturePage({
      ...pageInput,
      page: { value: [], "@odata.deltaLink": link },
    })
  );
}
assert.throws(() =>
  applyFixturePage({
    ...pageInput,
    page: {
      ...initialPage,
      value: [
        {
          id: "partial-must-not-leak",
          parentFolderId: folderId,
          isRead: false,
          changeKey: "partial",
        },
        { id: "malformed" },
      ],
    },
  })
);
assert.equal(connection.folders.get(folderId), checkpoint);
assert.equal(checkpoint?.messages.has("partial-must-not-leak"), false);
applyFixturePage(pageInput);
assert.equal(connection.folders.get(folderId)?.messages.size, 1);
const deltaPage: GraphPage = {
  "@odata.deltaLink":
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque%2Fdelta%3D",
  value: [
    { id: "same-id", parentFolderId: folderId, isRead: true, changeKey: "a" },
  ],
};
applyFixturePage({ ...pageInput, page: deltaPage });
assert.equal(
  connection.folders.get(folderId)?.cursor,
  deltaPage["@odata.deltaLink"]
);
assert.equal(
  connection.folders.get(folderId)?.messages.get("same-id")?.isRead,
  true
);
process.stdout.write(
  "PASS synthetic page checkpoints, scope and opaque revisions\n"
);

const predicateLink =
  "https://graph.microsoft.com/v1.0/me/mailfolders('inbox')/messages/delta?$deltatoken=opaque%2Bpredicate%3D";
applyFixturePage({
  ...pageInput,
  page: { "@odata.deltaLink": predicateLink, value: [] },
});
assert.equal(connection.folders.get(folderId)?.cursor, predicateLink);

const otherConnection: Connection = {
  ...connection,
  mailboxId: "fixture-mailbox-b",
  folders: new Map(),
};
applyFixturePage({
  ...pageInput,
  connection: otherConnection,
  capturedScope: { ...capturedScope, mailboxId: otherConnection.mailboxId },
});
assert.equal(
  otherConnection.folders.get(folderId)?.messages.get("same-id")?.isRead,
  false
);
applyFixturePage({
  ...pageInput,
  folderId: "archive",
  page: {
    "@odata.deltaLink":
      "https://graph.microsoft.com/v1.0/me/mailFolders/archive/messages/delta?$deltatoken=archive",
    value: [
      {
        id: "same-id",
        parentFolderId: "archive",
        isRead: true,
        changeKey: "b",
      },
    ],
  },
});
applyFixturePage({
  ...pageInput,
  page: {
    ...deltaPage,
    value: [{ id: "same-id", "@removed": { reason: "deleted" } }],
  },
});
assert.equal(connection.folders.get(folderId)?.messages.size, 0);
assert.ok(connection.folders.get("archive")?.messages.has("same-id"));
assert.ok(otherConnection.folders.get(folderId)?.messages.has("same-id"));
assert.throws(() =>
  applyFixturePage({
    ...pageInput,
    connection: { ...connection, credentialGeneration: 2 },
  })
);
const failures: Parameters<typeof acceptFixtureConsent>[0]["tokenResult"][] = [
  "invalid_grant",
  "consent_denied",
];
for (const tokenResult of failures) {
  attempts.set(digest, attempt);
  const rejected = acceptFixtureConsent({ ...consent, tokenResult });
  assert.equal(rejected.kind, "needs_reconnect");
  assert.throws(() => applyFixturePage({ ...pageInput, connection: rejected }));
}
attempts.set(digest, attempt);
const missingScope = acceptFixtureConsent({
  ...consent,
  grantedScopes: ["User.Read"],
});
assert.equal(missingScope.kind, "needs_reconnect");
assert.throws(() =>
  applyFixturePage({ ...pageInput, connection: missingScope })
);
process.stdout.write(
  "PASS synthetic folder moves, mailbox isolation and revocation\n"
);
process.stdout.write(
  "Planning fixture passed. Live Outlook behavior remains unverified.\n"
);
