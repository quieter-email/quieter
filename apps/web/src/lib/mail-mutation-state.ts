import type { QueryClient } from "@tanstack/react-query";

export const pendingMailMutations = new WeakMap<QueryClient, Set<string>>();
