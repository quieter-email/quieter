export type SessionUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
  needsOnboarding: boolean;
  sessionId: string;
};

let cachedSessionUser: SessionUser | undefined;
let pendingSessionLoad: Promise<SessionUser | null> | undefined;
let sessionLoadGeneration = 0;
let revocationVersion = 0;
const revokedSessionIds = new Set<string>();
const revocationListeners = new Set<() => void>();

export const isSessionUser = (value: unknown): value is SessionUser =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "email") === "string" &&
  typeof Reflect.get(value, "emailVerified") === "boolean" &&
  typeof Reflect.get(value, "id") === "string" &&
  (Reflect.get(value, "image") === null ||
    typeof Reflect.get(value, "image") === "string") &&
  typeof Reflect.get(value, "name") === "string" &&
  typeof Reflect.get(value, "needsOnboarding") === "boolean" &&
  "sessionId" in value &&
  typeof value.sessionId === "string" &&
  value.sessionId.length > 0;

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
  if (typeof window === "undefined" || !cachedSessionUser) {
    return;
  }
  if (
    cachedSessionUser.id === live.id &&
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
  sessionLoadGeneration += 1;
  cachedSessionUser = undefined;
  pendingSessionLoad = undefined;
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
  if (sessionId === undefined || cachedSessionUser?.sessionId === sessionId) {
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
  sessionLoadGeneration += 1;
  const generation = sessionLoadGeneration;
  cachedSessionUser = undefined;
  const request = (async () => {
    const user = await fetcher();
    if (generation !== sessionLoadGeneration) {
      return cachedSessionUser ?? null;
    }
    if (user === null || revokedSessionIds.has(user.sessionId)) {
      return null;
    }
    if (!user.needsOnboarding) {
      cachedSessionUser = user;
    }
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
  fetcher: () => Promise<SessionUser | null>
): Promise<SessionUser | null> => {
  if (typeof window === "undefined") {
    return await fetcher();
  }
  if (
    cachedSessionUser &&
    !cachedSessionUser.needsOnboarding &&
    !revokedSessionIds.has(cachedSessionUser.sessionId)
  ) {
    return cachedSessionUser;
  }
  if (pendingSessionLoad) {
    return await pendingSessionLoad;
  }
  return await loadFreshSessionUser(fetcher);
};
