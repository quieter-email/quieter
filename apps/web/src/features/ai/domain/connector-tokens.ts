import type { RouterOutputs } from "@quieter/orpc";
import type { TokenFieldToken } from "@quieter/ui/token-field";

type ConnectorsData = RouterOutputs["connectors"]["list"];
type ConnectorProvider = ConnectorsData["connectors"][number]["provider"];

const connectorTokenDetails = {
  google_calendar: {
    iconClassName: "size-3.5",
    iconSrc: "/google-calendar.svg",
    keywords: ["calendar", "events", "meetings", "schedule"],
    label: "Calendar",
    text: "@Calendar",
    tone: "blue",
  },
  linear: {
    iconClassName: "size-3.5 invert dark:invert-0",
    iconSrc: "/linear.svg",
    keywords: ["bug", "issue", "ticket", "tracker"],
    label: "Linear",
    text: "@Linear",
    tone: "purple",
  },
} as const satisfies Record<
  ConnectorProvider,
  Pick<
    TokenFieldToken,
    "iconClassName" | "iconSrc" | "keywords" | "label" | "text"
  > & {
    tone: NonNullable<TokenFieldToken["tone"]>;
  }
>;

/**
 * Builds the mentions a composer can offer from the connectors the user has
 * actually connected. The token text is what the agent reads, so it must stay
 * the plain spelling the prompts already recognise.
 */
export const getConnectorTokens = (
  connectorsData: ConnectorsData | undefined
): TokenFieldToken[] =>
  (connectorsData?.connectors ?? [])
    .filter((connector) =>
      connector.accounts.some((account) => account.status === "connected")
    )
    .map((connector) => {
      const details = connectorTokenDetails[connector.provider];

      return {
        ...details,
        description: connector.displayName,
        id: connector.provider,
        keywords: [...details.keywords, connector.displayName],
      };
    });
