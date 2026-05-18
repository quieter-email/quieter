import {
  experimental_createQueryPersister,
  type AsyncStorage,
} from "@tanstack/query-persist-client-core";

const createBrowserQueryStorage = (): AsyncStorage<string> | undefined => {
  if (typeof window === "undefined") return undefined;

  return {
    getItem: async (key) => window.localStorage.getItem(key),
    setItem: async (key, value) => window.localStorage.setItem(key, value),
    removeItem: async (key) => window.localStorage.removeItem(key),
    entries: async () => Object.entries(window.localStorage),
  };
};

export const queryPersister = experimental_createQueryPersister({
  buster: "v3",
  storage: createBrowserQueryStorage(),
  refetchOnRestore: false,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  prefix: "quieter-cache",
});
