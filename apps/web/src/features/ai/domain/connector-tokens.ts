import type { RouterOutputs } from "@quieter/orpc";
import type { PillTone } from "@quieter/ui/pill";
import type { TokenFieldToken } from "@quieter/ui/token-field";

import { getConnectorIcon } from "#/lib/connector-icons";

type ConnectorsData = RouterOutputs["connectors"]["list"];

const MENTION_TONES = [
  "purple",
  "blue",
  "green",
  "orange",
  "cyan",
  "pink",
] as const satisfies readonly PillTone[];

/**
 * Picks a stable tone per connector so a mention keeps its colour between
 * sessions without anyone having to assign one by hand.
 */
const getMentionTone = (provider: string) => {
  let hash = 0;

  for (const character of provider) {
    hash = (hash + (character.codePointAt(0) ?? 0)) % MENTION_TONES.length;
  }

  return MENTION_TONES[hash] ?? MENTION_TONES[0];
};

/**
 * Builds the mentions a composer can offer from the connectors the user has
 * connected. Everything comes from the connector's own record, so a new
 * connector becomes mentionable without touching this file.
 */
export const getConnectorTokens = (
  connectorsData: ConnectorsData | undefined
): TokenFieldToken[] =>
  (connectorsData?.connectors ?? [])
    .filter(
      (connector) =>
        connector.supportsChatTools &&
        connector.accounts.some((account) => account.status === "connected")
    )
    .map((connector) => {
      const icon = getConnectorIcon(connector.provider);

      return {
        description: connector.description,
        iconClassName: `size-3.5 ${icon.className}`.trim(),
        iconSrc: icon.src,
        id: connector.provider,
        label: connector.displayName,
        text: `@${connector.displayName}`,
        tone: getMentionTone(connector.provider),
      };
    });
