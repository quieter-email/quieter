import { readUnifiedInboxPreferences } from "@quieter/app/features/mailbox/domain/unified-inbox";
import {
  readDefaultView,
  resolveDefaultViewSearch,
} from "@quieter/app/features/settings/domain/default-view-setting";
import { mailCache, MAIL_CACHE_MAX_AGE } from "@quieter/app/lib/mail-cache";
import {
  deferredMailPersistence,
  mailMutationCoordinators,
  pendingMailMutations,
} from "@quieter/app/lib/mail-mutation-state";
import { isMessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { purgeAuthorizedSessionUser } from "@quieter/app/session-user";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import type { PersistedQuery } from "@tanstack/query-persist-client-core";
import { hashKey, notifyManager } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

const CACHE_BUSTER = "v8";
const CACHE_PREFIX = "quieter-cache";
const ACCOUNT_PREFERENCES_QUERY_KEY = [
  ["accountPreferences", "get"],
  { type: "query" },
] as const;
const WARM_MAILBOX_LIMIT = 8;
const WARM_SIDEBAR_COUNT_LIMIT = 6;
const PERSISTABLE_MAIL_CATEGORIES = new Set([
  "done",
  "drafts",
  "important",
  "inbox",
  "later",
  "sent",
  "spam",
  "trash",
  "unread",
]);
const SIDEBAR_COUNT_CATEGORIES = new Set([
  "done",
  "drafts",
  "important",
  "inbox",
  "later",
  "sent",
  "spam",
  "trash",
  "unread",
]);

const restoredMailboxesSchema = z.object({
  defaultMailboxId: z.string().nullable().optional(),
  groups: z.array(
    z.object({
      mailboxes: z.array(
        z.object({
          connectionStatus: z.string(),
          id: z.string(),
          provider: z.enum(["api", "gmail", "managed"]),
        })
      ),
    })
  ),
});

const sidebarPreferencesCountSchema = z.object({
  countEntries: z.array(z.string()),
});

const isSidebarMailCountQueryKey = (queryKey: readonly unknown[]) =>
  queryKey.length === 6 &&
  queryKey[0] === "messages" &&
  typeof queryKey[1] === "string" &&
  queryKey[1].length > 0 &&
  !isSandboxMailboxId(queryKey[1]) &&
  typeof queryKey[2] === "string" &&
  SIDEBAR_COUNT_CATEGORIES.has(queryKey[2]) &&
  queryKey[3] === "" &&
  queryKey[4] === "sidebar-count" &&
  typeof queryKey[5] === "string" &&
  queryKey[5].length > 0;

const isPersistedQuery = (value: unknown): value is PersistedQuery => {
  if (
    !(typeof value === "object" && value !== null) ||
    typeof Reflect.get(value, "buster") !== "string" ||
    typeof Reflect.get(value, "queryHash") !== "string" ||
    !Array.isArray(Reflect.get(value, "queryKey")) ||
    !("state" in value)
  ) {
    return false;
  }

  const state: unknown = value.state;
  if (typeof state !== "object" || state === null) {
    return false;
  }
  return (
    typeof Reflect.get(state, "dataUpdateCount") === "number" &&
    typeof Reflect.get(state, "dataUpdatedAt") === "number" &&
    typeof Reflect.get(state, "errorUpdateCount") === "number" &&
    typeof Reflect.get(state, "errorUpdatedAt") === "number" &&
    typeof Reflect.get(state, "fetchFailureCount") === "number" &&
    typeof Reflect.get(state, "isInvalidated") === "boolean" &&
    (Reflect.get(state, "status") === "pending" ||
      Reflect.get(state, "status") === "error" ||
      Reflect.get(state, "status") === "success") &&
    (Reflect.get(state, "fetchStatus") === "idle" ||
      Reflect.get(state, "fetchStatus") === "fetching" ||
      Reflect.get(state, "fetchStatus") === "paused")
  );
};

const deserializePersistedQuery = (value: string): PersistedQuery => {
  const parsed: unknown = JSON.parse(value);
  if (!isPersistedQuery(parsed)) {
    throw new Error("Invalid persisted query.");
  }
  return parsed;
};

let persistenceUser: string | undefined;
let persistenceGeneration = 0;
let persistenceSession: string | undefined;
let persistenceInitialized = false;
let persistenceClient: QueryClient | undefined;

const bodyCacheSchema = z.object({
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
});
const threadCacheSchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      bodyHtml: z.string().optional(),
      bodyText: z.string().optional(),
      id: z.string(),
    })
  ),
});

const createPersister = (generation: number) => {
  const ownerClient = persistenceClient;
  const pendingWrites = new Set<Promise<void>>();
  const storage = {
    entries: async () =>
      generation === persistenceGeneration ? await mailCache.entries() : [],
    getItem: async (key: string) => {
      if (generation !== persistenceGeneration) {
        return null;
      }
      const value = await mailCache.getItem(key);
      return generation === persistenceGeneration ? value : null;
    },
    removeItem: async (key: string) => {
      if (generation === persistenceGeneration) {
        await mailCache.removeItem(key);
      }
    },
    setItem: async (key: string, value: string) => {
      if (generation === persistenceGeneration && value !== "") {
        const write = mailCache.setItem(key, value);
        pendingWrites.add(write);
        try {
          await write;
        } finally {
          pendingWrites.delete(write);
        }
      }
    },
  };
  const persister = experimental_createQueryPersister({
    buster: CACHE_BUSTER,
    deserialize: async (value) => {
      const parsed = deserializePersistedQuery(value);
      if (
        parsed.queryKey[0] === "calendar" &&
        parsed.queryKey[1] !== persistenceUser
      ) {
        throw new Error("Calendar cache belongs to a different account.");
      }
      if (
        isSidebarMailCountQueryKey(parsed.queryKey) &&
        parsed.queryKey[5] !== persistenceUser
      ) {
        throw new Error("Sidebar count cache belongs to a different account.");
      }
      if (parsed.queryKey[0] === "message-thread") {
        const detail = threadCacheSchema.parse(parsed.state.data);
        let missingBody = false;
        const messages = await Promise.all(
          detail.messages.map(async (message) => {
            const body = await storage.getItem(
              `body-${JSON.stringify([parsed.queryKey[2], message.id])}`
            );
            if (!body) {
              missingBody = true;
            }
            return body
              ? { ...message, ...bodyCacheSchema.parse(JSON.parse(body)) }
              : message;
          })
        );
        return {
          ...parsed,
          state: {
            ...parsed.state,
            data: { ...detail, messages },
            dataUpdatedAt: missingBody ? 0 : parsed.state.dataUpdatedAt,
          },
        };
      }
      return parsed;
    },
    maxAge: MAIL_CACHE_MAX_AGE,
    prefix: CACHE_PREFIX,
    // The SDK's restore refresh leaves query.fetch() rejections unhandled.
    refetchOnRestore: false,
    serialize: async (query) => {
      const mailboxId =
        query.queryKey[0] === "message-thread"
          ? query.queryKey[2]
          : query.queryKey[1];
      if (
        (query.queryKey[0] === "messages" &&
          isMessagesQueryData(query.state.data) &&
          query.state.data.pages[0]?.refreshing === true) ||
        generation !== persistenceGeneration ||
        (query.queryKey[0] === "calendar" &&
          query.queryKey[1] !== persistenceUser) ||
        (isSidebarMailCountQueryKey(query.queryKey) &&
          query.queryKey[5] !== persistenceUser) ||
        (typeof mailboxId === "string" && isSandboxMailboxId(mailboxId)) ||
        (ownerClient &&
          typeof mailboxId === "string" &&
          pendingMailMutations.get(ownerClient)?.has(mailboxId) === true)
      ) {
        return "";
      }
      if (query.queryKey[0] === "message-thread") {
        const detail = threadCacheSchema.parse(query.state.data);
        for (const message of detail.messages) {
          if (
            message.bodyHtml !== undefined ||
            message.bodyText !== undefined
          ) {
            const key = `body-${JSON.stringify([query.queryKey[2], message.id])}`;
            const body = JSON.stringify({
              bodyHtml: message.bodyHtml,
              bodyText: message.bodyText,
            });
            if ((await storage.getItem(key)) !== body) {
              await storage.setItem(key, body);
            }
          }
        }
      }
      return JSON.stringify(query, (key, value: unknown) => {
        if (["bodyHtml", "bodyText", "headers", "raw"].includes(key)) {
          return undefined;
        }
        if ((key === "pages" || key === "pageParams") && Array.isArray(value)) {
          const pages: unknown[] = value;
          return pages.slice(0, 5);
        }
        return value;
      });
    },
    storage,
  });
  return {
    ...persister,
    persistQueryByKey: async (
      ...args: Parameters<typeof persister.persistQueryByKey>
    ) => {
      await persister.persistQueryByKey(...args);
      await Promise.all(pendingWrites);
    },
  };
};

let currentPersister = createPersister(persistenceGeneration);

export const queryPersister: ReturnType<
  typeof experimental_createQueryPersister
> = {
  persistQuery: async (query) => {
    if (persistenceClient?.getQueryCache().get(query.queryHash) === query) {
      await currentPersister.persistQuery(query);
    }
  },
  persistQueryByKey: async (key, client) => {
    if (persistenceClient === client) {
      await currentPersister.persistQueryByKey(key, client);
    }
  },
  persisterFn: async (queryFn, context, query) => {
    if (context.client !== persistenceClient) {
      return await queryFn(context);
    }
    const delegate = currentPersister;
    let restored = true;
    const data = await delegate.persisterFn(
      async (fetchContext) => {
        restored = false;
        return await queryFn(fetchContext);
      },
      context,
      query
    );
    if (restored && query.meta?.ownsMailLiveSync !== true) {
      notifyManager.schedule(() => {
        if (
          delegate === currentPersister &&
          !context.signal.aborted &&
          context.client.getQueryCache().get(query.queryHash) === query
        ) {
          void context.client.refetchQueries(
            {
              exact: true,
              queryKey: query.queryKey,
              stale: query.queryKey[0] === "mailboxes" ? undefined : true,
            },
            { cancelRefetch: false }
          );
        }
      });
    }
    return data;
  },
  persisterGc: async (...args) => {
    await currentPersister.persisterGc(...args);
  },
  removeQueries: async (...args) => {
    await currentPersister.removeQueries(...args);
  },
  restoreQueries: async (client, ...args) => {
    if (client === persistenceClient) {
      await currentPersister.restoreQueries(client, ...args);
    }
  },
  retrieveQuery: async (...args) =>
    await currentPersister.retrieveQuery(...args),
};

let logoutChannel: BroadcastChannel | undefined;
const sessionInvalidationListeners = new WeakMap<
  QueryClient,
  Set<() => void>
>();

export const subscribeQuerySessionInvalidation = (
  client: QueryClient,
  listener: () => void
) => {
  const listeners = sessionInvalidationListeners.get(client) ?? new Set();
  listeners.add(listener);
  sessionInvalidationListeners.set(client, listeners);
  return () => {
    listeners.delete(listener);
  };
};

const invalidateQuerySession = (client: QueryClient | undefined) => {
  if (client) {
    for (const listener of sessionInvalidationListeners.get(client) ?? []) {
      listener();
    }
  }
};

const updatePersistenceOwner = (
  userId: string | undefined,
  client?: QueryClient,
  sessionId?: string
) => {
  persistenceInitialized = true;
  if (persistenceClient) {
    invalidateQuerySession(persistenceClient);
    mailMutationCoordinators.get(persistenceClient)?.dispose();
    deferredMailPersistence.delete(persistenceClient);
  }
  persistenceUser = userId;
  persistenceSession = sessionId;
  persistenceClient = client;
  persistenceGeneration += 1;
  currentPersister = createPersister(persistenceGeneration);
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("quieter-cache:") === true) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* Browser storage access may be denied. */
  }
};

export const setQueryPersistenceUser = (
  userId: string | null | undefined,
  client?: QueryClient,
  sessionId = userId ?? undefined
) => {
  if (
    typeof window === "undefined" ||
    (persistenceInitialized &&
      persistenceUser === (userId ?? undefined) &&
      persistenceClient === client &&
      persistenceSession === sessionId)
  ) {
    return;
  }
  try {
    if (!logoutChannel && typeof window.BroadcastChannel === "function") {
      logoutChannel = new window.BroadcastChannel("quieter-cache-logout");
      logoutChannel.addEventListener(
        "message",
        (event: MessageEvent<unknown>) => {
          if (
            typeof event.data === "string" &&
            event.data === persistenceSession
          ) {
            const previousClient = persistenceClient;
            purgeAuthorizedSessionUser(persistenceSession);
            invalidateQuerySession(previousClient);
            updatePersistenceOwner(undefined);
            mailCache.detach();
            previousClient?.clear();
          }
        }
      );
    }
  } catch {
    /* The browser may deny cross-tab messaging. */
  }
  updatePersistenceOwner(userId ?? undefined, client, sessionId);
  void mailCache.setUser(persistenceUser, sessionId);
};

export const captureQueryPersistenceCleanup = () => {
  const previousSession = persistenceSession;
  const previousUser = persistenceUser;
  const previousClient = persistenceClient;
  const clear = mailCache.captureCleanup();
  if (!clear) {
    return undefined;
  }
  return Object.assign(
    async () => {
      purgeAuthorizedSessionUser(previousSession);
      invalidateQuerySession(previousClient);
      if (
        persistenceSession === previousSession &&
        persistenceUser === previousUser &&
        persistenceClient === previousClient
      ) {
        const currentClient = persistenceClient;
        updatePersistenceOwner(undefined);
        currentClient?.clear();
      }
      previousClient?.clear();
      await clear();
      try {
        if (previousSession) {
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel messages are restricted to the same origin and accept no targetOrigin.
          logoutChannel?.postMessage(previousSession);
        }
      } catch {
        /* The browser may deny cross-tab messaging. */
      }
    },
    { isCurrent: clear.isCurrent }
  );
};

export const clearQueryPersistence = async () => {
  await captureQueryPersistenceCleanup()?.();
};

export const shouldPersistQueryKey = (queryKey: readonly unknown[]) => {
  if (
    queryKey.length === 1 &&
    (queryKey[0] === "mailboxes" || queryKey[0] === "gmail-unread-counts")
  ) {
    return true;
  }
  if (
    queryKey.length === 2 &&
    Array.isArray(queryKey[0]) &&
    queryKey[0][0] === "accountPreferences" &&
    queryKey[0][1] === "get"
  ) {
    return true;
  }
  if (queryKey[0] === "calendar") {
    return (
      typeof queryKey[1] === "string" &&
      queryKey[1].length > 0 &&
      ((queryKey.length === 3 && queryKey[2] === "accounts") ||
        (queryKey[2] === "connection" &&
          typeof queryKey[3] === "string" &&
          queryKey[3].length > 0 &&
          ((queryKey.length === 5 && queryKey[4] === "calendars") ||
            (queryKey.length === 8 &&
              queryKey[4] === "calendar" &&
              typeof queryKey[5] === "string" &&
              queryKey[5].length > 0 &&
              ((queryKey[6] === "event" &&
                typeof queryKey[7] === "string" &&
                queryKey[7].length > 0) ||
                (queryKey[6] === "events" &&
                  typeof queryKey[7] === "object" &&
                  queryKey[7] !== null))))))
    );
  }
  if (queryKey[0] === "message-thread" && queryKey.length === 4) {
    return (
      typeof queryKey[2] === "string" &&
      queryKey[2].length > 0 &&
      !isSandboxMailboxId(queryKey[2]) &&
      typeof queryKey[3] === "string"
    );
  }
  if (queryKey.length === 2) {
    return (
      (queryKey[0] === "gmail-labels" ||
        queryKey[0] === "label-organization" ||
        queryKey[0] === "managed-label-counts") &&
      typeof queryKey[1] === "string" &&
      queryKey[1].length > 0 &&
      !isSandboxMailboxId(queryKey[1])
    );
  }
  if (isSidebarMailCountQueryKey(queryKey)) {
    return true;
  }

  return (
    queryKey.length === 4 &&
    queryKey[0] === "messages" &&
    typeof queryKey[1] === "string" &&
    queryKey[1].length > 0 &&
    !isSandboxMailboxId(queryKey[1]) &&
    typeof queryKey[2] === "string" &&
    PERSISTABLE_MAIL_CATEGORIES.has(queryKey[2]) &&
    queryKey[3] === ""
  );
};

const readWarmSidebarCountEntries = (userId: string): string[] => {
  if (typeof window === "undefined" || !userId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(`quieter:sidebar:${userId}`);
    if (!raw) {
      return [];
    }
    const parsed = sidebarPreferencesCountSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return [];
    }
    return [...new Set(parsed.data.countEntries)]
      .filter((entry) => SIDEBAR_COUNT_CATEGORIES.has(entry))
      .slice(0, WARM_SIDEBAR_COUNT_LIMIT);
  } catch {
    return [];
  }
};

const hydrateWarmBatch = (
  client: QueryClient,
  batch: ReadonlyMap<string, string>,
  generation: number,
  userId: string
) => {
  if (
    generation !== persistenceGeneration ||
    persistenceClient !== client ||
    persistenceUser !== userId ||
    batch.size === 0
  ) {
    return;
  }
  const manifest = restoredMailboxesSchema.safeParse(
    client.getQueryData(["mailboxes"])
  );
  const authorized = new Set(
    manifest.success
      ? manifest.data.groups.flatMap(({ mailboxes }) =>
          mailboxes.map(({ id }) => id)
        )
      : []
  );
  const currentTime = Date.now();
  notifyManager.batch(() => {
    for (const [storageKey, raw] of batch) {
      if (
        generation !== persistenceGeneration ||
        persistenceClient !== client ||
        persistenceUser !== userId
      ) {
        return;
      }
      let stored: PersistedQuery;
      try {
        stored = deserializePersistedQuery(raw);
      } catch {
        continue;
      }
      if (
        stored.buster !== CACHE_BUSTER ||
        stored.state.status !== "success" ||
        stored.state.dataUpdatedAt <= 0 ||
        currentTime - stored.state.dataUpdatedAt > MAIL_CACHE_MAX_AGE ||
        storageKey !== `${CACHE_PREFIX}-${stored.queryHash}` ||
        !shouldPersistQueryKey(stored.queryKey)
      ) {
        continue;
      }
      if (
        (typeof stored.queryKey[1] === "string" &&
          [
            "messages",
            "gmail-labels",
            "label-organization",
            "managed-label-counts",
          ].includes(String(stored.queryKey[0])) &&
          !authorized.has(stored.queryKey[1])) ||
        (stored.queryKey[0] === "calendar" && stored.queryKey[1] !== userId) ||
        (isSidebarMailCountQueryKey(stored.queryKey) &&
          stored.queryKey[5] !== userId)
      ) {
        continue;
      }
      if (client.getQueryData(stored.queryKey) === undefined) {
        client.setQueryData(stored.queryKey, stored.state.data, {
          updatedAt: stored.state.dataUpdatedAt,
        });
      }
    }
  });
};

const collectMailboxWarmQueryKeys = ({
  countEntries,
  hotCategory,
  includeHotList,
  mailboxId,
  provider,
  userId,
}: {
  countEntries: readonly string[];
  hotCategory: string;
  includeHotList: boolean;
  mailboxId: string;
  provider?: "api" | "gmail" | "managed";
  userId: string;
}): (readonly unknown[])[] => {
  if (!mailboxId || isSandboxMailboxId(mailboxId)) {
    return [];
  }
  const keys: (readonly unknown[])[] = [];
  if (includeHotList) {
    const category = provider === "api" ? "sent" : hotCategory;
    if (PERSISTABLE_MAIL_CATEGORIES.has(category)) {
      keys.push(["messages", mailboxId, category, ""]);
    }
    if (provider !== "api" && category !== "inbox") {
      keys.push(["messages", mailboxId, "inbox", ""]);
    }
  }
  if (provider !== "api") {
    keys.push(["gmail-labels", mailboxId], ["label-organization", mailboxId]);
  }
  if (provider === undefined || provider === "managed") {
    keys.push(["managed-label-counts", mailboxId]);
  }
  for (const entry of countEntries) {
    if (provider === "api" && entry !== "sent") {
      continue;
    }
    keys.push(["messages", mailboxId, entry, "", "sidebar-count", userId]);
  }
  return keys;
};

export const restoreWarmWorkspaceQueries = async (
  client: QueryClient,
  userId: string,
  options: { search?: string } = {}
) => {
  if (
    typeof window === "undefined" ||
    persistenceUser !== userId ||
    persistenceClient !== client
  ) {
    return;
  }
  const generation = persistenceGeneration;
  const search = options.search ?? "";
  const params = new URLSearchParams(search);
  const urlMailboxId = params.get("mailboxId")?.trim() ?? "";
  const rawMailbox = params.get("mailbox")?.trim() ?? "";
  const urlView = params.get("view")?.trim() ?? "";
  const urlQuery = params.get("query")?.trim() ?? "";
  const urlWorkspace = params.get("workspace")?.trim() ?? "";
  const defaultView = readDefaultView(userId);
  const startupSearch = resolveDefaultViewSearch({ search, view: defaultView });
  const requestedCategory =
    rawMailbox === "scheduled"
      ? "sent"
      : rawMailbox || startupSearch?.mailbox || "inbox";
  const hotCategory = PERSISTABLE_MAIL_CATEGORIES.has(requestedCategory)
    ? requestedCategory
    : "inbox";
  const countEntries = readWarmSidebarCountEntries(userId);
  const fetchedStorageKeys = new Set<string>();
  const toStorageKeys = (queryKeys: readonly (readonly unknown[])[]) => {
    const batchKeys: string[] = [];
    for (const queryKey of queryKeys) {
      if (client.getQueryData(queryKey) !== undefined) {
        continue;
      }
      const storageKey = `${CACHE_PREFIX}-${hashKey(queryKey)}`;
      if (!fetchedStorageKeys.has(storageKey)) {
        fetchedStorageKeys.add(storageKey);
        batchKeys.push(storageKey);
      }
    }
    return batchKeys;
  };

  const initialQueryKeys: (readonly unknown[])[] = [
    ["mailboxes"],
    ["gmail-unread-counts"],
    ACCOUNT_PREFERENCES_QUERY_KEY,
    ["calendar", userId, "accounts"],
  ];
  const initialStorageKeys = toStorageKeys(initialQueryKeys);
  if (initialStorageKeys.length > 0) {
    const firstBatch = await mailCache.getItems(initialStorageKeys);
    hydrateWarmBatch(client, firstBatch, generation, userId);
  }
  if (
    generation !== persistenceGeneration ||
    persistenceClient !== client ||
    persistenceUser !== userId
  ) {
    return;
  }
  const parsedMailboxes = restoredMailboxesSchema.safeParse(
    client.getQueryData(["mailboxes"])
  );
  if (!parsedMailboxes.success) {
    return;
  }
  const mailboxes = parsedMailboxes.data.groups.flatMap(
    (group) => group.mailboxes
  );
  if (mailboxes.length === 0) {
    return;
  }
  const opensDefaultMailbox =
    urlView === "" &&
    urlMailboxId === "" &&
    (rawMailbox === "" || rawMailbox === "inbox") &&
    !params.get("chatId") &&
    !params.get("compose") &&
    !params.get("mailto") &&
    !params.get("messageId") &&
    !params.get("threadId") &&
    urlQuery === "" &&
    urlWorkspace === "" &&
    startupSearch?.workspace !== "calendar";
  const allInboxes =
    urlView === "all-inboxes" ||
    (opensDefaultMailbox &&
      (parsedMailboxes.data.defaultMailboxId ?? null) === null &&
      mailboxes.some((mailbox) => mailbox.provider !== "api"));
  const excludedIds = allInboxes
    ? new Set(readUnifiedInboxPreferences(userId).excludedIds)
    : new Set<string>();
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === urlMailboxId) ??
    mailboxes.find(
      (mailbox) => mailbox.id === parsedMailboxes.data.defaultMailboxId
    ) ??
    mailboxes[0];
  const singleMailboxTargets =
    selectedMailbox?.connectionStatus === "connected" ? [selectedMailbox] : [];
  const targets = allInboxes
    ? mailboxes
        .filter(
          (mailbox) =>
            mailbox.connectionStatus === "connected" &&
            mailbox.provider !== "api" &&
            !excludedIds.has(mailbox.id)
        )
        .slice(0, WARM_MAILBOX_LIMIT)
    : singleMailboxTargets;

  const secondaryQueryKeys = targets.flatMap((mailbox) =>
    collectMailboxWarmQueryKeys({
      countEntries,
      hotCategory,
      includeHotList: urlQuery === "" && urlWorkspace !== "calendar",
      mailboxId: mailbox.id,
      provider: mailbox.provider,
      userId,
    })
  );
  const secondaryStorageKeys = toStorageKeys(secondaryQueryKeys);
  if (secondaryStorageKeys.length > 0) {
    const secondBatch = await mailCache.getItems(secondaryStorageKeys);
    hydrateWarmBatch(client, secondBatch, generation, userId);
  }
};

export const removeCalendarScopePersistence = async (
  userId: string,
  connectionId: string,
  calendarId?: string
) => {
  if (persistenceUser !== userId) {
    return;
  }
  persistenceGeneration += 1;
  currentPersister = createPersister(persistenceGeneration);
  await mailCache.removeCalendarScope(connectionId, calendarId);
  if (calendarId === undefined) {
    await queryPersister.removeQueries({
      queryKey: ["calendar", userId, "accounts"],
    });
  }
};

export const restoreMissingCalendarScopeQueries = async (
  client: QueryClient,
  userId: string,
  connectionId: string,
  calendarId: string
) => {
  if (persistenceUser !== userId || persistenceClient !== client) {
    return;
  }
  for (const [storageKey, value] of await mailCache.entries()) {
    if (!storageKey.startsWith("quieter-cache-")) {
      continue;
    }
    let stored: PersistedQuery;
    try {
      stored = deserializePersistedQuery(value);
    } catch {
      continue;
    }
    const key = stored.queryKey;
    if (
      key[0] !== "calendar" ||
      key[1] !== userId ||
      key[2] !== "connection" ||
      key[3] !== connectionId ||
      !(
        (key.length === 5 && key[4] === "calendars") ||
        (key.length === 8 &&
          key[4] === "calendar" &&
          key[5] === calendarId &&
          (key[6] === "event" || key[6] === "events"))
      ) ||
      storageKey !== `quieter-cache-${stored.queryHash}` ||
      client.getQueryData(key) !== undefined
    ) {
      continue;
    }
    const data = await queryPersister.retrieveQuery<unknown>(stored.queryHash);
    if (persistenceUser !== userId || persistenceClient !== client) {
      return;
    }
    if (data !== undefined && client.getQueryData(key) === undefined) {
      client.setQueryData(key, data, { updatedAt: stored.state.dataUpdatedAt });
    }
  }
};

export const persistQueryByKey = async (
  queryKey: readonly unknown[] | undefined,
  queryClient: Parameters<typeof queryPersister.persistQueryByKey>[1]
) => {
  if (
    persistenceClient !== queryClient ||
    !queryKey ||
    !shouldPersistQueryKey(queryKey)
  ) {
    return;
  }
  const mailboxId =
    queryKey[0] === "message-thread" ? queryKey[2] : queryKey[1];
  if (
    typeof mailboxId === "string" &&
    pendingMailMutations.get(queryClient)?.has(mailboxId) === true
  ) {
    let keys = deferredMailPersistence.get(queryClient);
    if (!keys) {
      keys = new Map();
      deferredMailPersistence.set(queryClient, keys);
    }
    keys.set(JSON.stringify(queryKey), queryKey);
    return;
  }
  try {
    await queryPersister.persistQueryByKey(queryKey, queryClient);
  } catch {
    /* Persistence is optional. */
  }
};

export const flushMailPersistence = async (
  client: QueryClient,
  mailboxId: string
) => {
  const keys = deferredMailPersistence.get(client);
  if (!keys || pendingMailMutations.get(client)?.has(mailboxId) === true) {
    return;
  }
  const ready: (readonly unknown[])[] = [];
  for (const [hash, key] of keys) {
    if ((key[0] === "message-thread" ? key[2] : key[1]) === mailboxId) {
      keys.delete(hash);
      ready.push(key);
    }
  }
  await Promise.all(
    ready.map(async (key) => {
      await persistQueryByKey(key, client);
    })
  );
};
