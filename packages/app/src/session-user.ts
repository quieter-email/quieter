import { z } from "zod";

const sessionUserSchema = z.object({
  email: z.string(),
  emailVerified: z.boolean(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  needsOnboarding: z.boolean(),
  sessionId: z.string().min(1),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

const isSessionUser = (value: unknown): value is SessionUser =>
  sessionUserSchema.safeParse(value).success;

let cachedSessionUser: SessionUser | undefined;
let pendingSessionLoad: Promise<SessionUser | null> | undefined;
let sessionLoadGeneration = 0;
let liveSessionId: string | undefined;
let revocationVersion = 0;
const revokedSessionIds = new Set<string>();
const revocationListeners = new Set<() => void>();

export const extractRouteSessionUser = (
  matches: readonly { loaderData?: unknown }[]
): SessionUser | undefined => {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const loaderData = matches[index]?.loaderData;
    if (
      typeof loaderData === "object" &&
      loaderData !== null &&
      "user" in loaderData &&
      isSessionUser(loaderData.user)
    ) {
      return loaderData.user;
    }
  }
  return undefined;
};

export const seedAuthorizedSessionUser = (user: SessionUser | undefined) => {
  if (
    typeof window === "undefined" ||
    user === undefined ||
    user.needsOnboarding ||
    revokedSessionIds.has(user.sessionId)
  ) {
    return;
  }
  if (
    cachedSessionUser?.id === user.id &&
    cachedSessionUser.sessionId === user.sessionId
  ) {
    return;
  }
  cachedSessionUser = user;
};

export const syncAuthorizedSessionUser = (live: {
  email?: string;
  emailVerified?: boolean;
  id: string;
  image?: string | null;
  name?: string;
  sessionId: string;
}) => {
  if (typeof window === "undefined") {
    return;
  }
  if (liveSessionId !== live.sessionId) {
    liveSessionId = live.sessionId;
    sessionLoadGeneration += 1;
    pendingSessionLoad = undefined;
  }
  if (
    cachedSessionUser?.id === live.id &&
    cachedSessionUser.sessionId === live.sessionId
  ) {
    cachedSessionUser = {
      ...cachedSessionUser,
      email: live.email ?? cachedSessionUser.email,
      emailVerified: live.emailVerified ?? cachedSessionUser.emailVerified,
      image: live.image === undefined ? cachedSessionUser.image : live.image,
      name: live.name ?? cachedSessionUser.name,
    };
    return;
  }
  cachedSessionUser = undefined;
};

export const purgeAuthorizedSessionUser = (sessionId?: string) => {
  if (typeof window === "undefined") {
    return;
  }
  if (revokedSessionIds.size > 64) {
    revokedSessionIds.clear();
  }
  if (sessionId) {
    revokedSessionIds.add(sessionId);
  }
  if (sessionId === undefined || liveSessionId === sessionId) {
    liveSessionId = undefined;
  }
  if (
    sessionId === undefined ||
    cachedSessionUser?.sessionId === sessionId ||
    (cachedSessionUser === undefined && liveSessionId === undefined)
  ) {
    sessionLoadGeneration += 1;
    cachedSessionUser = undefined;
    pendingSessionLoad = undefined;
  }
  revocationVersion += 1;
  for (const listener of revocationListeners) {
    listener();
  }
};

export const isAuthorizedSessionRevoked = (sessionId: string | undefined) =>
  typeof window !== "undefined" &&
  sessionId !== undefined &&
  revokedSessionIds.has(sessionId);

export const getSessionRevocationVersion = () => revocationVersion;

export const subscribeSessionRevocation = (listener: () => void) => {
  revocationListeners.add(listener);
  return () => {
    revocationListeners.delete(listener);
  };
};

export const loadFreshSessionUser = async (
  fetcher: () => Promise<SessionUser | null>
): Promise<SessionUser | null> => {
  if (typeof window === "undefined") {
    return await fetcher();
  }
  if (pendingSessionLoad !== undefined) {
    return await pendingSessionLoad;
  }
  const generation = sessionLoadGeneration;
  const request = (async () => {
    const user = await fetcher();
    if (generation !== sessionLoadGeneration) {
      return liveSessionId === undefined
        ? null
        : await loadFreshSessionUser(fetcher);
    }
    if (user === null) {
      const expiredSessionId = liveSessionId ?? cachedSessionUser?.sessionId;
      if (expiredSessionId !== undefined) {
        purgeAuthorizedSessionUser(expiredSessionId);
      }
      return null;
    }
    if (revokedSessionIds.has(user.sessionId)) {
      return null;
    }
    cachedSessionUser = user.needsOnboarding ? undefined : user;
    return user;
  })();
  pendingSessionLoad = request;
  try {
    return await request;
  } finally {
    if (pendingSessionLoad === request) {
      pendingSessionLoad = undefined;
    }
  }
};

export const loadAuthorizedSessionUser = async (
  fetcher: () => Promise<SessionUser | null>,
  { revalidate = false }: { revalidate?: boolean } = {}
): Promise<SessionUser | null> => {
  if (typeof window === "undefined") {
    return await fetcher();
  }
  if (
    cachedSessionUser &&
    !cachedSessionUser.needsOnboarding &&
    !revokedSessionIds.has(cachedSessionUser.sessionId)
  ) {
    const user = cachedSessionUser;
    if (revalidate) {
      void (async () => {
        try {
          const current = await loadFreshSessionUser(fetcher);
          if (
            current?.sessionId !== user.sessionId &&
            !revokedSessionIds.has(user.sessionId)
          ) {
            purgeAuthorizedSessionUser(user.sessionId);
          }
        } catch {
          // The session observer can retry a temporary connection failure.
        }
      })();
    }
    return user;
  }
  if (pendingSessionLoad) {
    return await pendingSessionLoad;
  }
  return await loadFreshSessionUser(fetcher);
};
