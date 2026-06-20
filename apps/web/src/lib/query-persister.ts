import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";

export const queryPersister = experimental_createQueryPersister({
  buster: "v4",
  storage: undefined,
  prefix: "quieter-cache",
});
