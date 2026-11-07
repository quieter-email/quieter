import {
  aiMemory,
  chat,
  chatMessage,
  gmailCapturedMessage,
  managedMailMessage,
} from "@quieter/database/schema";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

export type SemanticSearchScope = {
  kind: "memory" | "chat" | "mail";
  mailboxId: string;
  userId: string;
};

export const semanticSourceQuery = (
  input: SemanticSearchScope,
  provider: "gmail" | "managed"
) => {
  let projected: SQL;
  if (input.kind === "memory") {
    projected = sql`select 'memory'::text as kind, ${aiMemory.id} as id,
          ${aiMemory.content} as content, ${aiMemory.summary} as title, ${aiMemory.version} as version,
          null::text as "threadId", null::text as "chatId", ${aiMemory.updatedAt} as "updatedAt",
          ${aiMemory.id} as "memoryId", null::text as "chatMessageId",
          null::text as "gmailMailboxId", null::text as "gmailMessageId", null::text as "managedMessageId"
        from ${aiMemory}
        where ${aiMemory.scope} = 'user' and ${aiMemory.scopeKey} = ${`user:${input.userId}`}
          and ${aiMemory.userId} = ${input.userId} and ${aiMemory.status} = 'active'
          and (${aiMemory.expiresAt} is null or ${aiMemory.expiresAt} > now())
          and (${aiMemory.metadata}->>'sourceMailboxId' is null or ${aiMemory.metadata}->>'sourceMailboxId' = ${input.mailboxId})`;
  } else if (input.kind === "chat") {
    projected = sql`select 'chat'::text as kind, ${chatMessage.id} as id,
            coalesce((select string_agg(part->>'text', '' order by ordinal)
              from jsonb_array_elements(${chatMessage.parts}) with ordinality as parts(part, ordinal)
              where part->>'type' = 'text'), '') as content,
            coalesce(${chat.title}, 'New chat') as title, 0 as version,
            null::text as "threadId", ${chat.id} as "chatId", ${chat.updatedAt} as "updatedAt",
            null::text as "memoryId", ${chatMessage.id} as "chatMessageId",
            null::text as "gmailMailboxId", null::text as "gmailMessageId", null::text as "managedMessageId"
          from ${chatMessage} inner join ${chat} on ${chat.id} = ${chatMessage.chatId} and ${chat.userId} = ${chatMessage.userId}
          where ${chat.userId} = ${input.userId} and ${chat.mailboxId} = ${input.mailboxId}
            and ${chatMessage.role} in ('user', 'assistant')`;
  } else if (provider === "gmail") {
    projected = sql`select 'gmail'::text as kind, ${gmailCapturedMessage.messageId} as id,
              concat_ws(E'\n',
                (select value->>'value' from jsonb_array_elements(${gmailCapturedMessage.snapshot}->'headers')
                  where lower(value->>'name') = 'subject' limit 1),
                coalesce(nullif(${gmailCapturedMessage.snapshot}->>'bodyText', ''),
                  regexp_replace(coalesce(${gmailCapturedMessage.snapshot}->>'bodyHtml', ''), '<[^>]*>', ' ', 'g'))) as content,
              coalesce((select value->>'value' from jsonb_array_elements(${gmailCapturedMessage.snapshot}->'headers')
                where lower(value->>'name') = 'subject' limit 1), 'Message') as title, 0 as version,
              ${gmailCapturedMessage.snapshot}->>'threadId' as "threadId", null::text as "chatId",
              ${gmailCapturedMessage.updatedAt} as "updatedAt", null::text as "memoryId", null::text as "chatMessageId",
              ${gmailCapturedMessage.mailboxId} as "gmailMailboxId", ${gmailCapturedMessage.messageId} as "gmailMessageId",
              null::text as "managedMessageId"
            from ${gmailCapturedMessage}
            where ${gmailCapturedMessage.mailboxId} = ${input.mailboxId}
              and ${gmailCapturedMessage.deletedAt} is null and ${gmailCapturedMessage.snapshot} is not null
              and not (coalesce(${gmailCapturedMessage.snapshot}->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])`;
  } else {
    projected = sql`select 'managed'::text as kind, ${managedMailMessage.id} as id,
              concat_ws(E'\n', ${managedMailMessage.subject}, coalesce(nullif(${managedMailMessage.bodyText}, ''),
                regexp_replace(coalesce(${managedMailMessage.bodyHtml}, ''), '<[^>]*>', ' ', 'g'))) as content,
              coalesce(${managedMailMessage.subject}, 'Message') as title, 0 as version,
              ${managedMailMessage.threadId} as "threadId", null::text as "chatId", ${managedMailMessage.updatedAt} as "updatedAt",
              null::text as "memoryId", null::text as "chatMessageId", null::text as "gmailMailboxId", null::text as "gmailMessageId",
              ${managedMailMessage.id} as "managedMessageId"
            from ${managedMailMessage}
            where ${managedMailMessage.mailboxId} = ${input.mailboxId}
              and ${managedMailMessage.mailboxState} in ('active', 'archived')`;
  }
  const whitespacePattern =
    "[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+";
  return sql`select normalized.*, md5(jsonb_build_array(content, version)::text) as "sourceRevision",
      jsonb_build_array(kind, id, coalesce("gmailMailboxId", ''))::text as "sourceKey"
    from (
      select kind, id, btrim(regexp_replace(content, ${whitespacePattern}, ' ', 'g')) as content,
        title, version, "threadId", "chatId", "updatedAt", "memoryId", "chatMessageId",
        "gmailMailboxId", "gmailMessageId", "managedMessageId"
      from (${projected}) as projected
    ) as normalized where content <> ''`;
};
