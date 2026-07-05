import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export type ConnectorProvider = "google_calendar" | "linear";

export const CONNECTORS_QUERY_KEY = ["connectors"] as const;

export const connectorsQueryOptions = () =>
  queryOptions({
    queryKey: CONNECTORS_QUERY_KEY,
    queryFn: ({ signal }) => rpc.connectors.list(undefined, { signal }),
    staleTime: 60_000,
  });

export const openConnectorLink = async (input: {
  provider: ConnectorProvider;
  returnTo: string;
}) => {
  const { authorizationUrl } = await rpc.connectors.startConnection(input);
  window.location.assign(authorizationUrl);
};
